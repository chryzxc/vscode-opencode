import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:opacity-90 text-oc-sm",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        chip: "rounded-full border border-oc-border bg-transparent text-oc-text-muted font-mono text-xs hover:bg-oc-panel-soft hover:border-oc-accent hover:text-oc-text-soft",
        queue:
          "rounded-full border border-oc-border bg-transparent text-oc-text-muted font-mono text-xs hover:bg-oc-panel-soft hover:text-oc-text-soft",
        send: "rounded-full border border-transparent bg-oc-accent text-white font-mono text-xs font-semibold hover:opacity-90 active:opacity-75",
        stop: "rounded-full border border-oc-red/40 bg-oc-red/10 text-oc-red font-mono text-xs hover:bg-oc-red/20 hover:border-oc-red/70",
        "ghost-accent": "hover:bg-oc-accent-soft hover:text-oc-accent",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-md px-3 text-oc-sm",
        lg: "h-9 rounded-md px-6",
        icon: "h-7 w-7 p-0",
        chip: "h-auto px-2 py-1 leading-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
