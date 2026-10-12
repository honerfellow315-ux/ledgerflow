"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "@/lib/icons";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 min-w-0 max-w-full w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-surface px-3 py-2 text-[13px] shadow-xs cursor-pointer transition-[border-color,box-shadow,background-color] data-[placeholder]:text-muted-foreground hover:border-border-strong focus:outline-hidden focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 [&>span]:line-clamp-1 [&>span]:min-w-0 [&>span]:text-left",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

/** Search keeps items mounted so the selected label survives filtering. */
function optionText(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child))
        return optionText(child.props.children);
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & { searchable?: boolean }
>(
  (
    { className, children, position = "popper", searchable = true, onCloseAutoFocus, ...props },
    ref,
  ) => {
    const [query, setQuery] = React.useState("");
    const focusSearch = React.useCallback((node: HTMLInputElement | null) => {
      if (node)
        requestAnimationFrame(() => {
          if (node.isConnected) node.focus({ preventScroll: true });
        });
    }, []);
    const term = query.trim().toLocaleLowerCase();
    let matches = 0;
    const filter = (nodes: React.ReactNode): React.ReactNode =>
      React.Children.map(nodes, (node) => {
        if (
          !React.isValidElement<{
            children?: React.ReactNode;
            textValue?: string;
            disabled?: boolean;
            hidden?: boolean;
            style?: React.CSSProperties;
          }>(node)
        )
          return node;
        if (node.type === SelectItem) {
          const shown =
            !term ||
            (node.props.textValue ?? optionText(node.props.children))
              .toLocaleLowerCase()
              .includes(term);
          if (shown) matches++;
          return React.cloneElement(node, {
            hidden: !shown,
            disabled: node.props.disabled || !shown,
            style: { ...node.props.style, ...(!shown ? { display: "none" } : {}) },
          });
        }
        return node.props.children
          ? React.cloneElement(node, { children: filter(node.props.children) })
          : node;
      });
    const options = searchable ? filter(children) : children;
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "relative z-50 flex max-h-[min(24rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-1.5rem)] min-w-[8rem] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[var(--shadow-menu)]",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
            className,
          )}
          position={position}
          onCloseAutoFocus={(event) => {
            setQuery("");
            onCloseAutoFocus?.(event);
          }}
          {...props}
        >
          {searchable ? (
            <div className="shrink-0 border-b p-2" role="presentation">
              <input
                ref={focusSearch}
                type="search"
                aria-label="Search options"
                placeholder="Search options…"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" || event.key === "Tab") return;
                  event.stopPropagation();
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const items = Array.from(
                      event.currentTarget
                        .closest('[role="listbox"]')
                        ?.querySelectorAll<HTMLElement>(
                          '[role="option"]:not([data-disabled]):not([hidden])',
                        ) ?? [],
                    );
                    (event.key === "ArrowDown" ? items[0] : items.at(-1))?.focus();
                  }
                  if (event.key === "Enter") event.preventDefault();
                }}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
          ) : null}
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              "min-h-0 overflow-y-auto p-1",
              position === "popper" &&
                "w-full min-w-[min(var(--radix-select-trigger-width),calc(100vw-1.5rem))]",
            )}
          >
            {options}
            {searchable && matches === 0 ? (
              <div role="status" className="p-3 text-sm text-muted-foreground">
                No matching options
              </div>
            ) : null}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-2 pr-8 text-[13px] outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
