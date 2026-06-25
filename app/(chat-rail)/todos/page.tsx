/**
 * @fileType page
 * @domain todos
 * @pattern todos-page
 * @ai-summary Kody worklist entry point. Manages lightweight todo files stored
 * at `todos/<slug>.md` in the configured state repo.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { TodoControl } from "@dashboard/lib/components/TodoControl";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Todos — Kody Operations Dashboard",
  description: "Repo-scoped worklist items Kody should keep visible.",
  path: "/todos",
});

export default function TodosPage() {
  return (
    <AuthGuard>
      <TodoControl />
    </AuthGuard>
  );
}
