/**
 * @fileType page
 * @domain kody
 * @pattern scenario-list-page
 * @ai-summary List page for viewing all scenarios
 */
import Link from "next/link";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dashboard/ui/card";
import { Badge } from "@dashboard/ui/badge";

export const metadata = {
  title: "Scenarios",
  description: "View and manage all scenarios",
  path: "/scenario/list",
};

interface ScenarioSummary {
  id: string;
  name: string;
  type: string;
  path: string;
}

async function getScenarios(): Promise<{
  scenarios: ScenarioSummary[];
  prototypes: string[];
}> {
  try {
    // Fetch scenarios from API
    const scenariosRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/kody/scenario/scenarios`,
      {
        cache: "no-store",
      },
    );
    const scenariosData = scenariosRes.ok
      ? await scenariosRes.json()
      : { scenarios: [] };

    // Fetch prototypes
    const { listPrototypes } = await import("@dashboard/lib/scenario-stub");
    const prototypes = await listPrototypes();

    return {
      scenarios: scenariosData.scenarios || [],
      prototypes,
    };
  } catch {
    return { scenarios: [], prototypes: [] };
  }
}

export default async function ScenarioListPage() {
  const { scenarios, prototypes } = await getScenarios();

  // Group scenarios by type
  const coreScenarios = scenarios.filter((s) => s.type === "core");
  const featureScenarios = scenarios.filter((s) => s.type === "feature");
  const edgeScenarios = scenarios.filter((s) => s.type === "edge");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-2xl font-bold">Scenarios</h1>
            <p className="text-sm text-muted-foreground">
              {scenarios.length} scenario{scenarios.length !== 1 ? "s" : ""}{" "}
              total
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/scenario">
              <Button>New Scenario</Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container py-6 space-y-8">
        {/* Quick Start */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Create a New Scenario</h2>
                <p className="text-sm text-muted-foreground">
                  Use the step-by-step wizard to create a scenario from
                  prototypes and design system components
                </p>
              </div>
              <Link href="/scenario">
                <Button>Start Wizard</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Scenarios by Category */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Scenario Categories</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Core</span>
                  <Badge variant="default">{coreScenarios.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Critical user flows and main functionality
                </p>
                {coreScenarios.length > 0 ? (
                  <ul className="space-y-1 mb-4">
                    {coreScenarios.slice(0, 3).map((s) => (
                      <li key={s.id} className="text-sm truncate">
                        {s.name}
                      </li>
                    ))}
                    {coreScenarios.length > 3 && (
                      <li className="text-xs text-muted-foreground">
                        +{coreScenarios.length - 3} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4">
                    No scenarios yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Feature</span>
                  <Badge variant="secondary">{featureScenarios.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Specific feature functionality
                </p>
                {featureScenarios.length > 0 ? (
                  <ul className="space-y-1 mb-4">
                    {featureScenarios.slice(0, 3).map((s) => (
                      <li key={s.id} className="text-sm truncate">
                        {s.name}
                      </li>
                    ))}
                    {featureScenarios.length > 3 && (
                      <li className="text-xs text-muted-foreground">
                        +{featureScenarios.length - 3} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4">
                    No scenarios yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Edge Case</span>
                  <Badge variant="outline">{edgeScenarios.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Boundary conditions
                </p>
                {edgeScenarios.length > 0 ? (
                  <ul className="space-y-1 mb-4">
                    {edgeScenarios.slice(0, 3).map((s) => (
                      <li key={s.id} className="text-sm truncate">
                        {s.name}
                      </li>
                    ))}
                    {edgeScenarios.length > 3 && (
                      <li className="text-xs text-muted-foreground">
                        +{edgeScenarios.length - 3} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4">
                    No scenarios yet
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Prototypes Info */}
        {prototypes.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Available Prototypes</h2>
            <div className="flex flex-wrap gap-2">
              {prototypes.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
