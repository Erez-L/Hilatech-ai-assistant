'use client';

import * as React from 'react';

/**
 * Built-in user-visible strings of the design system. English defaults keep the package usable on its own;
 * apps override them (and translate) through `UiStringsProvider`.
 */
export interface UiStrings {
  close: string;
  confirm: string;
  cancel: string;
  copy: string;
  copied: string;
  copyCode: string;
  loading: string;
  select: string;
  search: string;
  noResults: string;
  searching: string;
  clearSelection: string;
  clearSearch: string;
  tryAgain: string;
  somethingWentWrong: string;
  loadFailed: string;
  request: (id: string) => string;
  pagination: string;
  rows: string;
  previousPage: string;
  nextPage: string;
  items: string;
  noItems: (label: string) => string;
  itemsRange: (start: number, end: number, total: number, label: string) => string;
  pageOf: (page: number, total: number) => string;
  addTag: string;
  removeTag: (tag: string) => string;
  selectedTags: string;
  primaryNavigation: string;
  empty: string;
  tree: string;
  raw: string;
  collapse: (name: string) => string;
  expand: (name: string) => string;
  total: string;
  /** Translates validation messages encoded by the app (identity by default). */
  formatMessage: (message: string) => string;
  /** Label for a well-known status value (StatusBadge default). */
  statusLabel: (status: string) => string;
}

export const defaultUiStrings: UiStrings = {
  formatMessage: (message) => message,
  statusLabel: (status) => status.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
  close: 'Close',
  confirm: 'Confirm',
  cancel: 'Cancel',
  copy: 'Copy',
  copied: 'Copied',
  copyCode: 'Copy code',
  loading: 'Loading',
  select: 'Select…',
  search: 'Search…',
  noResults: 'No results.',
  searching: 'Searching…',
  clearSelection: 'Clear selection',
  clearSearch: 'Clear search',
  tryAgain: 'Try again',
  somethingWentWrong: 'Something went wrong',
  loadFailed: 'The data could not be loaded. Check your connection and try again.',
  request: (id) => `Request ${id}`,
  pagination: 'Pagination',
  rows: 'Rows',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  items: 'items',
  noItems: (label) => `No ${label}`,
  itemsRange: (start, end, total, label) => `${start}–${end} of ${total} ${label}`,
  pageOf: (page, total) => `Page ${page} of ${total}`,
  addTag: 'Add a tag',
  removeTag: (tag) => `Remove ${tag}`,
  selectedTags: 'Selected tags',
  primaryNavigation: 'Primary',
  empty: 'Empty',
  tree: 'Tree',
  raw: 'Raw',
  collapse: (name) => `Collapse ${name}`,
  expand: (name) => `Expand ${name}`,
  total: 'Total',
};

const UiStringsContext = React.createContext<UiStrings>(defaultUiStrings);

export function UiStringsProvider({
  strings,
  children,
}: {
  strings: Partial<UiStrings>;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ ...defaultUiStrings, ...strings }), [strings]);
  return <UiStringsContext.Provider value={value}>{children}</UiStringsContext.Provider>;
}

export function useUiStrings(): UiStrings {
  return React.useContext(UiStringsContext);
}
