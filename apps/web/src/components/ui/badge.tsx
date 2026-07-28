import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

// shadcn-on-base-ui badge, trimmed to the variants the zinc token set actually
// has (t3code's info/success/warning variants want tokens that arrive with the
// geist theme in QK-WB-006). This is the native workbench's <badge> — count
// badges in section headers (QK-NAT-011) and status chips on rows.
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
