export interface PlanFile {
  path: string;
  type: 'MODIFY' | 'NEW' | 'DELETE';
  summary?: string;
}

export interface PlanStep {
  title: string;
  description?: string;
  completed: boolean;
}

export interface VerificationStep {
  type: 'Automated' | 'Manual';
  description: string;
}

export interface ImplementationPlan {
  goal: string;
  description?: string;
  files: PlanFile[];
  steps: PlanStep[];
  verification: VerificationStep[];
  rawContent: string;
}
