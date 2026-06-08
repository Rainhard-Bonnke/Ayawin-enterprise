import { cn } from "@/lib/utils";

/** Ambient workspace backdrop — grid + soft brand glow. */
export function AiShellBackground({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-0 -z-10 app-shell-bg", className)}>
      <div
        className="absolute inset-0 opacity-[0.45] dark:opacity-[0.35]"
        style={{
          backgroundImage: `
            linear-gradient(var(--shell-grid) 1px, transparent 1px),
            linear-gradient(90deg, var(--shell-grid) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 85% 70% at 50% 0%, black 20%, transparent 75%)",
        }}
      />
      <div
        className="absolute -left-[20%] top-0 h-[55vh] w-[70%] rounded-full blur-[100px]"
        style={{ background: "var(--shell-glow)" }}
      />
      <div
        className="absolute -right-[10%] bottom-0 h-[40vh] w-[50%] rounded-full blur-[120px] opacity-60"
        style={{ background: "oklch(0.28 0.06 250 / 12%)" }}
      />
    </div>
  );
}
