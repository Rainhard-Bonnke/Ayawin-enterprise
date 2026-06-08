import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type Crumb = { label: string; to?: string };

export function DetailNav({
  backLabel = "Back",
  backTo,
  onBack,
  crumbs,
}: {
  backLabel?: string;
  backTo?: string;
  onBack?: () => void;
  crumbs?: Crumb[];
}) {
  return (
    <nav className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" aria-label="Breadcrumb">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </button>
      ) : backTo ? (
        <Link
          to={backTo}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Link>
      ) : null}
      {crumbs && crumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="contents">
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {i < crumbs.length - 1 && c.to ? (
                    <BreadcrumbLink asChild>
                      <Link to={c.to}>{c.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{c.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
    </nav>
  );
}
