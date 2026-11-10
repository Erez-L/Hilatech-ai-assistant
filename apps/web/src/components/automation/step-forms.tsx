'use client';

import * as React from 'react';
import { ALL_DOMAIN_EVENTS, LeadStatus, type WorkflowStep } from '@hilatech/contracts';
import {
  Checkbox,
  FormField,
  Input,
  Label,
  NativeSelect,
  Switch,
  TagInput,
  Textarea,
} from '@hilatech/ui';
import { CONDITION_OPERATORS, eventLabel } from '@/lib/automation';
import { AgentPicker, UserPicker } from './pickers';
import { KeyValueEditor } from './key-value-editor';
import { useT } from '@/i18n/provider';

export interface StepFieldsProps {
  step: WorkflowStep;
  onChange: (next: WorkflowStep) => void;
  /** Unique prefix for element ids (one per step card). */
  idPrefix: string;
  /** Raw JSON text for the steps that carry a `payload` object. */
  payloadText?: string;
  onPayloadText: (text: string) => void;
  /** Ids of steps after this one (valid targets of a condition). */
  laterStepIds: string[];
  /** Field-level messages keyed by the step field name (`agentId`, `url`, …). */
  errors: Record<string, string>;
}

const TEMPLATE_HINT = 'Supports {{ trigger.payload.… }} and {{ steps.<id>.output… }} templates.';

/** The configuration form of a single workflow step; one branch per step type. */
export function StepFields({
  step,
  onChange,
  idPrefix,
  payloadText,
  onPayloadText,
  laterStepIds,
  errors,
}: StepFieldsProps) {
  const t = useT();
  const fid = (name: string) => `${idPrefix}-${name}`;

  switch (step.type) {
    case 'agent_run':
      return (
        <div className="grid gap-4">
          <FormField id={fid('agentId')} label={t('common.agent')} required error={errors.agentId}>
            <AgentPicker
              id={fid('agentId')}
              value={step.agentId}
              invalid={!!errors.agentId}
              onChange={(agentId) => onChange({ ...step, agentId })}
            />
          </FormField>
          <FormField
            id={fid('input')}
            label={t('automation.taskForTheAgent')}
            description={TEMPLATE_HINT}
            error={errors.input}
          >
            <Textarea
              rows={3}
              value={step.input}
              onChange={(e) => onChange({ ...step, input: e.target.value })}
            />
          </FormField>
          <FormField
            id={fid('wait')}
            inline
            label={t('automation.waitForTheAgentTo')}
            description={t('automation.offTheAgentIsQueued')}
          >
            <Switch checked={step.wait} onCheckedChange={(wait) => onChange({ ...step, wait })} />
          </FormField>
        </div>
      );

    case 'send_notification':
      return (
        <div className="grid gap-4">
          <FormField id={fid('to-kind')} label={t('automation.sendTo')} required error={errors.to}>
            <NativeSelect
              value={step.to.kind}
              onChange={(e) => {
                const kind = e.target.value as 'user' | 'assignee' | 'role';
                onChange({
                  ...step,
                  to:
                    kind === 'user'
                      ? { kind, userId: '' }
                      : kind === 'role'
                        ? { kind, roleKey: '' }
                        : { kind },
                });
              }}
            >
              <option value="assignee">{t('automation.theLeadConversationAssignee')}</option>
              <option value="user">{t('automation.aSpecificPerson')}</option>
              <option value="role">{t('automation.everyoneWithARole')}</option>
            </NativeSelect>
          </FormField>
          {step.to.kind === 'user' ? (
            <FormField
              id={fid('to-user')}
              label={t('automation.person')}
              required
              error={errors['to.userId']}
            >
              <UserPicker
                id={fid('to-user')}
                value={step.to.userId}
                invalid={!!errors['to.userId']}
                onChange={(userId) => onChange({ ...step, to: { kind: 'user', userId } })}
              />
            </FormField>
          ) : null}
          {step.to.kind === 'role' ? (
            <FormField
              id={fid('to-role')}
              label={t('automation.roleKey')}
              required
              description={t('automation.forExampleOwnerOrAdmin')}
              error={errors['to.roleKey']}
            >
              <Input
                value={step.to.roleKey}
                onChange={(e) =>
                  onChange({ ...step, to: { kind: 'role', roleKey: e.target.value } })
                }
              />
            </FormField>
          ) : null}
          <FormField
            id={fid('title')}
            label={t('common.title')}
            required
            description={TEMPLATE_HINT}
            error={errors.title}
          >
            <Input
              value={step.title}
              onChange={(e) => onChange({ ...step, title: e.target.value })}
            />
          </FormField>
          <FormField id={fid('body')} label={t('automation.message')} error={errors.body}>
            <Textarea
              rows={2}
              value={step.body ?? ''}
              onChange={(e) => onChange({ ...step, body: e.target.value || undefined })}
            />
          </FormField>
          <FormField
            id={fid('link')}
            label={t('automation.link')}
            description={t('automation.anInAppPathSuch')}
            error={errors.link}
          >
            <Input
              value={step.link ?? ''}
              onChange={(e) => onChange({ ...step, link: e.target.value || undefined })}
            />
          </FormField>
        </div>
      );

    case 'http_request':
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <FormField id={fid('method')} label={t('automation.method')}>
              <NativeSelect
                value={step.method}
                onChange={(e) =>
                  onChange({ ...step, method: e.target.value as typeof step.method })
                }
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              id={fid('url')}
              label={t('automation.url')}
              required
              description={TEMPLATE_HINT}
              error={errors.url}
            >
              <Input
                value={step.url}
                placeholder={t('automation.httpsApiExampleComHook')}
                onChange={(e) => onChange({ ...step, url: e.target.value })}
              />
            </FormField>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('automation.headers2')}</Label>
            <KeyValueEditor
              idPrefix={fid('headers')}
              label={t('common.header')}
              value={step.headers}
              onChange={(headers) => onChange({ ...step, headers })}
            />
            {errors.headers ? <p className="text-xs text-danger">{errors.headers}</p> : null}
          </div>
          <FormField id={fid('body')} label={t('automation.body')} error={errors.body}>
            <Textarea
              rows={3}
              className="font-mono text-xs"
              value={step.body ?? ''}
              onChange={(e) => onChange({ ...step, body: e.target.value || undefined })}
            />
          </FormField>
          <FormField
            id={fid('timeout')}
            label={t('automation.timeoutMs')}
            description={t('automation.between1000And60000')}
            error={errors.timeoutMs}
          >
            <Input
              type="number"
              min={1000}
              max={60000}
              step={500}
              value={step.timeoutMs}
              onChange={(e) => onChange({ ...step, timeoutMs: Number(e.target.value) })}
            />
          </FormField>
        </div>
      );

    case 'update_lead':
      return (
        <div className="grid gap-4">
          <FormField
            id={fid('leadId')}
            label={t('common.lead')}
            required
            description={t('automation.aLeadIdOrTemplate')}
            error={errors.leadId}
          >
            <Input
              value={step.leadId}
              onChange={(e) => onChange({ ...step, leadId: e.target.value })}
            />
          </FormField>
          <FormField id={fid('status')} label={t('automation.setStatus')} error={errors.status}>
            <NativeSelect
              value={step.status ?? ''}
              onChange={(e) =>
                onChange({ ...step, status: (e.target.value || undefined) as typeof step.status })
              }
            >
              <option value="">{t('automation.leaveUnchanged')}</option>
              {LeadStatus.options.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            id={fid('assigneeId')}
            label={t('automation.assignTo')}
            description={t('automation.aUserIdOrTemplate')}
            error={errors.assigneeId}
          >
            <Input
              value={step.assigneeId ?? ''}
              onChange={(e) => onChange({ ...step, assigneeId: e.target.value || undefined })}
            />
          </FormField>
          <FormField
            id={fid('addTags')}
            label={t('automation.addTags')}
            description={t('automation.upTo10Tags')}
            error={errors.addTags}
          >
            <TagInput
              value={step.addTags}
              maxTags={10}
              maxLength={40}
              onValueChange={(addTags) => onChange({ ...step, addTags })}
            />
          </FormField>
        </div>
      );

    case 'create_lead_note':
      return (
        <div className="grid gap-4">
          <FormField
            id={fid('leadId')}
            label={t('common.lead')}
            required
            description={t('automation.aLeadIdOrTemplate')}
            error={errors.leadId}
          >
            <Input
              value={step.leadId}
              onChange={(e) => onChange({ ...step, leadId: e.target.value })}
            />
          </FormField>
          <FormField
            id={fid('body')}
            label={t('automation.note')}
            required
            description={TEMPLATE_HINT}
            error={errors.body}
          >
            <Textarea
              rows={3}
              value={step.body}
              onChange={(e) => onChange({ ...step, body: e.target.value })}
            />
          </FormField>
        </div>
      );

    case 'delay':
      return (
        <FormField
          id={fid('seconds')}
          label={t('automation.waitSeconds')}
          required
          description={t('automation.between1SecondAnd24')}
          error={errors.seconds}
        >
          <Input
            type="number"
            min={1}
            max={86400}
            value={step.seconds}
            onChange={(e) => onChange({ ...step, seconds: Number(e.target.value) })}
          />
        </FormField>
      );

    case 'condition':
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id={fid('left')} label={t('common.value')} required error={errors.left}>
              <Input
                value={step.left}
                placeholder={t('automation.text2')}
                onChange={(e) => onChange({ ...step, left: e.target.value })}
              />
            </FormField>
            <FormField id={fid('operator')} label={t('automation.operator')}>
              <NativeSelect
                value={step.operator}
                onChange={(e) =>
                  onChange({ ...step, operator: e.target.value as typeof step.operator })
                }
              >
                {CONDITION_OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id={fid('right')} label={t('automation.comparedWith')} error={errors.right}>
              <Input
                value={step.right ?? ''}
                disabled={step.operator === 'exists'}
                onChange={(e) => onChange({ ...step, right: e.target.value || undefined })}
              />
            </FormField>
          </div>
          <BranchPicker
            legend={t('automation.whenTrueRun')}
            idPrefix={fid('then')}
            options={laterStepIds}
            value={step.then}
            error={errors.then}
            onChange={(then) => onChange({ ...step, then })}
          />
          <BranchPicker
            legend={t('automation.otherwiseRun')}
            idPrefix={fid('else')}
            options={laterStepIds}
            value={step.else}
            error={errors.else}
            onChange={(next) => onChange({ ...step, else: next })}
          />
        </div>
      );

    case 'n8n_trigger':
      return (
        <div className="grid gap-4">
          <FormField
            id={fid('webhook')}
            label={t('automation.n8nWebhook')}
            required
            description={t('automation.aWebhookPathUsesYour')}
            error={errors.webhook}
          >
            <Input
              value={step.webhook}
              placeholder={t('automation.webhookNewLead')}
              onChange={(e) => onChange({ ...step, webhook: e.target.value })}
            />
          </FormField>
          <PayloadField
            id={fid('payload')}
            text={payloadText}
            onText={onPayloadText}
            error={errors.payload}
          />
        </div>
      );

    case 'outbound_webhook':
      return (
        <div className="grid gap-4">
          <FormField
            id={fid('event')}
            label={t('automation.eventName')}
            required
            description={t('automation.deliveredToSubscriptionsListeningFor')}
            error={errors.event}
          >
            <Input
              list={fid('event-list')}
              value={step.event}
              onChange={(e) => onChange({ ...step, event: e.target.value })}
            />
          </FormField>
          <datalist id={fid('event-list')}>
            {ALL_DOMAIN_EVENTS.map((ev) => (
              <option key={ev} value={ev} label={eventLabel(ev, t)} />
            ))}
          </datalist>
          <PayloadField
            id={fid('payload')}
            text={payloadText}
            onText={onPayloadText}
            error={errors.payload}
          />
        </div>
      );

    case 'set_variable':
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={fid('name')}
            label={t('automation.variableName')}
            required
            description={t('automation.readLaterAs')}
            error={errors.name}
          >
            <Input
              value={step.name}
              onChange={(e) => onChange({ ...step, name: e.target.value })}
            />
          </FormField>
          <FormField
            id={fid('value')}
            label={t('common.value')}
            description={TEMPLATE_HINT}
            error={errors.value}
          >
            <Input
              value={step.value}
              onChange={(e) => onChange({ ...step, value: e.target.value })}
            />
          </FormField>
        </div>
      );
  }
}

function PayloadField({
  id,
  text,
  onText,
  error,
}: {
  id: string;
  text?: string;
  onText: (text: string) => void;
  error?: string;
}) {
  const t = useT();
  return (
    <FormField id={id} label={t('automation.payloadJsonObject')} error={error}>
      <Textarea
        rows={4}
        className="font-mono text-xs"
        value={text ?? '{}'}
        spellCheck={false}
        onChange={(e) => onText(e.target.value)}
      />
    </FormField>
  );
}

function BranchPicker({
  legend,
  idPrefix,
  options,
  value,
  error,
  onChange,
}: {
  legend: string;
  idPrefix: string;
  options: string[];
  value: string[];
  error?: string;
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  // Keep ids that no longer exist visible so the validator's complaint is actionable.
  const all = Array.from(new Set([...options, ...value]));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {all.length === 0 ? (
        <p className="text-xs text-fg-muted">{t('automation.addStepsAfterThisOne')}</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {all.map((stepId) => {
            const checkboxId = `${idPrefix}-${stepId}`;
            const known = options.includes(stepId);
            return (
              <div key={stepId} className="flex items-center gap-2">
                <Checkbox
                  id={checkboxId}
                  aria-label={t('automation.step', { legend, stepId })}
                  checked={value.includes(stepId)}
                  onCheckedChange={(checked) =>
                    onChange(checked ? [...value, stepId] : value.filter((v) => v !== stepId))
                  }
                />
                <Label
                  htmlFor={checkboxId}
                  className={known ? 'font-normal' : 'font-normal text-danger'}
                >
                  {stepId}
                  {known ? '' : t('automation.missing')}
                </Label>
              </div>
            );
          })}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
