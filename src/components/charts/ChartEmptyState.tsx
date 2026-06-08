export function ChartEmptyState({ message }: { message: string }) {
  return (
    <p className="flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}
