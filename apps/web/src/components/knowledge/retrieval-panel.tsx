'use client';

import * as React from 'react';
import { FileText, SearchCheck } from 'lucide-react';
import {
  knowledgeSearchSchema,
  type KnowledgeBase,
  type KnowledgeSearchHit,
} from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  Input,
  NativeSelect,
  Textarea,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useKnowledgeSearch } from '@/hooks/knowledge';
import { AiNotConfigured } from '@/components/ai/ai-not-configured';
import { zodFieldErrors } from '@/lib/forms/zod-errors';

export function formatScore(score: number): string {
  return score.toFixed(3);
}

/** Retrieval test: POST /knowledge/search and show the hits with their source and similarity score. */
export function RetrievalPanel({
  baseId,
  bases,
  idPrefix = 'retrieval',
}: {
  /** Restrict the search to one knowledge base; omit to search every base of the organization. */
  baseId?: string;
  /** Used to name the source base of each hit. */
  bases?: KnowledgeBase[];
  idPrefix?: string;
}) {
  const search = useKnowledgeSearch();
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState('5');
  const [minScore, setMinScore] = React.useState('0.2');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [notConfigured, setNotConfigured] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const baseName = (id: string) => bases?.find((b) => b.id === id)?.name;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotConfigured(false);
    const parsed = knowledgeSearchSchema.safeParse({
      query,
      knowledgeBaseIds: baseId ? [baseId] : undefined,
      limit: Number(limit),
      minScore: minScore.trim() === '' ? undefined : Number(minScore),
    });
    if (!parsed.success) {
      const found = zodFieldErrors(parsed.error);
      setErrors({
        ...(found.query ? { query: 'Enter a question or phrase to search for' } : {}),
        ...(found.minScore ? { minScore: 'Enter a number between 0 and 1' } : {}),
      });
      return;
    }
    setErrors({});
    try {
      await search.mutateAsync(parsed.data);
    } catch (e) {
      if (isApiError(e) && e.code === 'AI_NOT_CONFIGURED') setNotConfigured(true);
      else setError(getErrorMessage(e));
    }
  };

  const result = search.data;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Retrieval test</CardTitle>
          <CardDescription>
            Run the same semantic search the assistant and agents use. Only documents that are ready
            are searched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormField id={`${idPrefix}-query`} label="Query" required error={errors.query}>
              <Textarea
                rows={2}
                value={query}
                maxLength={1000}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What is our refund policy?"
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField id={`${idPrefix}-limit`} label="Number of results">
                <NativeSelect value={limit} onChange={(e) => setLimit(e.target.value)}>
                  {[3, 5, 10, 20].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField
                id={`${idPrefix}-min-score`}
                label="Minimum score"
                description="Cosine similarity from 0 to 1."
                error={errors.minScore}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                />
              </FormField>
            </div>
            <div>
              <Button
                type="submit"
                loading={search.isPending}
                leadingIcon={<SearchCheck aria-hidden />}
              >
                Run search
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {notConfigured ? <AiNotConfigured /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {result && !notConfigured ? (
        <section aria-label="Search results" className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted" role="status">
            {result.hits.length} {result.hits.length === 1 ? 'result' : 'results'} · model{' '}
            <span className="font-mono text-xs">{result.model}</span> · {result.tookMs} ms
          </p>
          {result.hits.length === 0 ? (
            <EmptyState
              compact
              icon={<FileText />}
              title="No matching passages"
              description="Nothing scored above the minimum score. Lower it, rephrase the query, or check that documents are ready."
            />
          ) : (
            <ol aria-label="Hits" className="flex flex-col gap-3">
              {result.hits.map((hit, i) => (
                <HitCard
                  key={hit.chunkId}
                  hit={hit}
                  rank={i + 1}
                  baseName={baseName(hit.knowledgeBaseId)}
                />
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}

function HitCard({
  hit,
  rank,
  baseName,
}: {
  hit: KnowledgeSearchHit;
  rank: number;
  baseName?: string;
}) {
  const pct = Math.max(0, Math.min(1, hit.score)) * 100;
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="tabular text-fg-subtle">#{rank}</span>
          <span className="flex items-center gap-1.5 font-medium">
            <FileText className="size-4 text-fg-muted" aria-hidden />
            {hit.documentTitle}
          </span>
          <Badge variant="outline">Chunk {hit.index + 1}</Badge>
          {baseName ? <Badge variant="neutral">{baseName}</Badge> : null}
        </div>
        <Badge variant="accent" className="tabular" aria-label={`Score ${formatScore(hit.score)}`}>
          Score {formatScore(hit.score)}
        </Badge>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-fg">{hit.content}</p>
    </li>
  );
}
