'use client';

import { Permission } from '@hilatech/contracts';
import { PermissionGate } from '@/components/common/permission-gate';
import { WorkflowEditor } from '@/components/automation/workflow-editor';

export function NewWorkflowView() {
  return (
    <PermissionGate anyOf={[Permission.AUTOMATIONS_MANAGE]}>
      <WorkflowEditor />
    </PermissionGate>
  );
}
