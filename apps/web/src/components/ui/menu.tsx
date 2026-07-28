import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";

// shadcn-on-base-ui menu, following t3code's apps/web/src/components/ui/menu.tsx
// but trimmed to what the ledger's View control needs: a trigger, a popup, and
// radio groups with labels. The native workbench's <dropdown-menu>/<menu-item>
// (apps/workbench/src/app.native) is what this stands in for; base-ui supplies
// the roving focus, typeahead and dismiss behavior that markup got for free
// on the canvas. `dropdown-glass` and the info/success tokens t3code styles
// with are QK-WB-006's business — this stays on popover/border/accent.

const Menu = MenuPrimitive.Root;

const MenuTrigger = MenuPrimitive.Trigger;

function MenuPopup({
  children,
  className,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  side?: MenuPrimitive.Positioner.Props["side"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        className="z-50"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-md outline-none",
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) overflow-y-auto p-1">{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

const menuRowClass =
  "flex min-h-7 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-xs outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-60";

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item className={cn(menuRowClass, className)} data-slot="menu-item" {...props} />
  );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn("px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase", className)}
      data-slot="menu-group-label"
      {...props}
    />
  );
}

function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

function MenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(menuRowClass, "ps-1.5", className)}
      data-slot="menu-radio-item"
      {...props}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon className="size-3 text-muted-foreground" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("mx-1 my-1 h-px bg-border", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

export {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
};
