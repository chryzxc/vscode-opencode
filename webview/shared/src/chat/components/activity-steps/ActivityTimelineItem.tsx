import type { ReactNode } from "react";
import { StepperItem } from "@/components/ui/stepper";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { cn } from "@/utils";

type Props = {
  id: string;
  isLast: boolean;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  animateEntrance?: boolean;
  children: ReactNode;
};

/** Shared shell for every visible activity-timeline item. */
export function ActivityTimelineItem({ id, isLast, status, animateEntrance = false, children }: Props) {
  return <StepperItem key={id} isLast={isLast} indicator={<StepIndicator status={status} />} className={cn("oc-refined-stepper-item group", animateEntrance && "oc-streaming-stack-entry", status === "running" && "is-streaming")}>{children}</StepperItem>;
}
