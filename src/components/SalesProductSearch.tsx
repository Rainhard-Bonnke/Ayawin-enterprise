import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BackendMasterItem } from "@/lib/api";

type Props = {
  items: BackendMasterItem[];
  value: string;
  onValueChange: (itemId: string) => void;
  disabled?: boolean;
  id?: string;
};

export function SalesProductSearch({ items, value, onValueChange, disabled, id }: Props) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);

  const activeItems = useMemo(() => items.filter((i) => i.is_active !== false), [items]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? `${selected.name} (${selected.item_code})` : "Search product…"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const hay = itemValue.toLowerCase();
            const q = search.toLowerCase();
            return hay.includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Name, SKU, or barcode…" />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {activeItems.map((item) => {
                const label = `${item.name} · ${item.item_code}${item.barcode ? ` · ${item.barcode}` : ""}`;
                return (
                  <CommandItem
                    key={item.id}
                    value={label}
                    onSelect={() => {
                      onValueChange(item.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === item.id ? "opacity-100" : "opacity-0")} />
                    {label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
