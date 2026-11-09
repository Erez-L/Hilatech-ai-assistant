'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-fg-muted',
        'transition-colors hover:text-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)}
      {...props}
    />
  );
});
