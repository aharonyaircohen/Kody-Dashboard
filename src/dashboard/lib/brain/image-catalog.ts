/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-catalog
 *
 * Shared Brain image catalog resolution. The durable state file is primary,
 * and GHCR discovery fills in recently pushed images that have not been
 * written back to state yet.
 */
import "server-only";

import { logger } from "@dashboard/lib/logger";
import { brainGhcrImageRef } from "./image-save";
import type { BrainImageFile, BrainSavedImage } from "./store";

interface GitHubPackageVersion {
  created_at?: unknown;
  updated_at?: unknown;
  metadata?: {
    container?: {
      tags?: unknown;
    };
  };
}

const IMAGE_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function brainImagePackage(input: { owner: string; account: string }): {
  baseRef: string;
  packageName: string;
} {
  const ref = brainGhcrImageRef({
    owner: input.owner,
    account: input.account,
    tag: "probe",
  });
  const baseRef = ref.replace(/:probe$/, "");
  const packageName = baseRef.split("/").at(-1);
  if (!packageName) {
    throw new Error("Invalid Brain image package");
  }
  return { baseRef, packageName };
}

function packageVersionUrl(input: {
  ownerKind: "orgs" | "users";
  owner: string;
  packageName: string;
  page: number;
}): string {
  const owner = encodeURIComponent(input.owner);
  const packageName = encodeURIComponent(input.packageName);
  return `https://api.github.com/${input.ownerKind}/${owner}/packages/container/${packageName}/versions?per_page=100&page=${input.page}`;
}

function sortBrainSavedImages(images: BrainSavedImage[]): BrainSavedImage[] {
  return [...images].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function brainImageCatalogFile(input: {
  previous: BrainImageFile | null;
  images: BrainSavedImage[];
  createdAt?: string;
  updatedAt?: string;
}): BrainImageFile {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const images = sortBrainSavedImages(input.images);
  const imageRefs = new Set(images.map((image) => image.imageRef));
  const forgottenImageRefs = (input.previous?.forgottenImageRefs ?? []).filter(
    (imageRef) => !imageRefs.has(imageRef),
  );
  return {
    version: 1,
    createdAt:
      input.previous?.createdAt ??
      input.createdAt ??
      images[0]?.createdAt ??
      updatedAt,
    updatedAt,
    images,
    ...(forgottenImageRefs.length > 0 ? { forgottenImageRefs } : {}),
  };
}

export function upsertBrainCatalogImageFile(
  previous: BrainImageFile | null,
  image: BrainSavedImage,
  updatedAt = new Date().toISOString(),
): BrainImageFile {
  const images = [
    image,
    ...(previous?.images ?? []).filter(
      (saved) => saved.imageRef !== image.imageRef,
    ),
  ];
  return brainImageCatalogFile({
    previous,
    images,
    createdAt: image.createdAt,
    updatedAt,
  });
}

function savedImagesFromPackageVersions(
  versions: GitHubPackageVersion[],
  baseRef: string,
): BrainSavedImage[] {
  const images: BrainSavedImage[] = [];
  for (const version of versions) {
    const tags = version.metadata?.container?.tags;
    if (!Array.isArray(tags)) continue;
    const createdAt =
      typeof version.created_at === "string"
        ? version.created_at
        : new Date().toISOString();
    const updatedAt =
      typeof version.updated_at === "string" ? version.updated_at : createdAt;
    for (const tag of tags) {
      if (typeof tag !== "string" || !IMAGE_TAG_RE.test(tag)) continue;
      images.push({
        imageRef: `${baseRef}:${tag}`,
        createdAt,
        updatedAt,
      });
    }
  }
  return sortBrainSavedImages(images);
}

export function mergeBrainSavedImages(
  image: BrainImageFile | null,
  discoveredImages: BrainSavedImage[],
): BrainSavedImage[] {
  const merged = new Map<string, BrainSavedImage>();
  const forgotten = new Set(image?.forgottenImageRefs ?? []);
  for (const discovered of discoveredImages) {
    if (forgotten.has(discovered.imageRef)) continue;
    merged.set(discovered.imageRef, discovered);
  }
  for (const saved of image?.images ?? []) {
    if (forgotten.has(saved.imageRef)) continue;
    if (!merged.has(saved.imageRef)) {
      merged.set(saved.imageRef, saved);
    }
  }
  if (
    image?.imageRef &&
    !forgotten.has(image.imageRef) &&
    !merged.has(image.imageRef)
  ) {
    merged.set(image.imageRef, {
      imageRef: image.imageRef,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
    });
  }
  return sortBrainSavedImages([...merged.values()]);
}

async function fetchBrainPackageImages(input: {
  owner: string;
  account: string;
  githubToken: string;
}): Promise<BrainSavedImage[]> {
  const { baseRef, packageName } = brainImagePackage(input);
  for (const ownerKind of ["orgs", "users"] as const) {
    const versions: GitHubPackageVersion[] = [];
    let page = 1;
    while (page <= 10) {
      const res = await fetch(
        packageVersionUrl({
          ownerKind,
          owner: input.owner,
          packageName,
          page,
        }),
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (res.status === 404 && page === 1) {
        break;
      }
      if (!res.ok) {
        throw new Error(`GitHub package versions lookup failed: ${res.status}`);
      }
      const pageVersions = (await res.json()) as unknown;
      if (!Array.isArray(pageVersions) || pageVersions.length === 0) {
        return savedImagesFromPackageVersions(versions, baseRef);
      }
      versions.push(...(pageVersions as GitHubPackageVersion[]));
      if (pageVersions.length < 100) {
        return savedImagesFromPackageVersions(versions, baseRef);
      }
      page += 1;
    }
  }
  return [];
}

export async function discoverBrainPackageImages(input: {
  owner: string;
  repo: string;
  account: string;
  githubToken: string;
}): Promise<BrainSavedImage[]> {
  try {
    return await fetchBrainPackageImages(input);
  } catch (err) {
    logger.warn(
      { err, owner: input.owner, repo: input.repo },
      "brain image GHCR history lookup failed",
    );
    return [];
  }
}
