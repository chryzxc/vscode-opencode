import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring oc-badge',
  {
    variants: {
      variant: {
        default:     'border-oc-border bg-primary text-primary-foreground hover:opacity-90',
        secondary:   'border-oc-border bg-secondary text-secondary-foreground hover:opacity-90',
        destructive:
          'border-transparent bg-oc-red/8 text-oc-red shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-red)_18%,transparent)] hover:opacity-90',
        outline:     'border-oc-border text-foreground',
        accent:      'border-oc-accent/35 bg-oc-accent-soft oc-tinted-badge-text',
        success:
          'border-transparent bg-oc-green/8 text-oc-green shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-green)_16%,transparent)]',
        error:
          'border-transparent bg-oc-red/8 text-oc-red shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-red)_18%,transparent)]',
        warning:
          'border-transparent bg-oc-yellow/8 text-oc-yellow shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-yellow)_16%,transparent)]',
        muted:       'border-oc-border bg-oc-panel-soft oc-text-secondary',
        status:      'border-oc-border font-medium bg-oc-panel-soft',
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };


