import { createFileRoute, useLocation } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === "string" ? { tab: search.tab } : {},
  component: Settings,
});

function Settings() {
  const { tab = "general" } = Route.useSearch();
  const { hash } = useLocation();
  return (
    <div>
      <h1>Settings</h1>
      <p>
        Tab: <span data-testid="tab">{tab}</span>
      </p>
      <p>
        Section: <span data-testid="section">{hash ? `#${hash}` : "none"}</span>
      </p>
    </div>
  );
}
