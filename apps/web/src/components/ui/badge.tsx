import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

// shadcn-on-base-ui badge. This is the native workbench's <badge> — count
// badges in section headers (QK-NAT-011) and status chips on rows.
//
// QK-WB-006 added the two lamp variants. The native markup wrote
// `<badge variant="primary">filt</badge>` and got the accent because
// `.theme_accent` repainted the primary channel; here primary is still the
// near-black zinc chip, so the accent is asked for by name instead.
const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium tabular-nums outline-none [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "secondary",
    },
    variants: {
      size: {
        default: "h-4.5 min-w-4.5 px-1 text-[10px]",
        sm: "h-4 min-w-4 rounded-[0.25rem] px-1 text-[10px]",
      },
      variant: {
        default: "bg-primary text-primary-foreground",
        /** The lamp lit: one thing per screen, and it is this one. */
        lamp: "bg-lamp text-lamp-foreground",
        /** The lamp's glow — a status that is live, not a thing to act on. */
        "lamp-soft": "border-lamp-line bg-lamp-soft text-lamp",
        outline: "border-input text-muted-foreground",
        secondary: "bg-secondary text-secondary-foreground",
      },
    },
  },
);

interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

function Badge({ className, variant, size, render, ...props }: BadgeProps) {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

export { Badge, badgeVariants };
