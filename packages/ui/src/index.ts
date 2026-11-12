// Utilities
export { cn } from './lib/cn';
export {
  formatBytesFromMb,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  initials,
} from './lib/format';

// Primitives
export { Button, IconButton, buttonVariants, iconButtonVariants } from './components/button';
export type { ButtonProps, IconButtonProps } from './components/button';
export {
  AutosizeTextarea,
  Input,
  Textarea,
  SearchInput,
  NativeSelect,
  inputClassName,
} from './components/input';
export type {
  AutosizeTextareaProps,
  InputProps,
  TextareaProps,
  SearchInputProps,
  NativeSelectProps,
} from './components/input';
export { Label } from './components/label';
export type { LabelProps } from './components/label';
export { FormField } from './components/form-field';
export type { FormFieldProps } from './components/form-field';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select';
export { Checkbox } from './components/checkbox';
export { Combobox } from './components/combobox';
export type { ComboboxItem, ComboboxProps } from './components/combobox';
export { TagInput } from './components/tag-input';
export type { TagInputProps } from './components/tag-input';
export { SegmentedControl } from './components/segmented-control';
export type { SegmentedControlProps, SegmentedOption } from './components/segmented-control';
export { Timeline, TimelineItem } from './components/timeline';
export type { TimelineItemProps, TimelineTone } from './components/timeline';
export { Switch } from './components/switch';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card';
export {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  SortableHead,
  sortRows,
} from './components/table';
export type { SortDirection, SortState, SortableHeadProps } from './components/table';
export { Badge, StatusBadge, badgeVariants, humanize } from './components/badge';
export type { BadgeProps, StatusBadgeProps, StatusTone } from './components/badge';
export { Avatar } from './components/avatar';
export type { AvatarProps } from './components/avatar';
export {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/dialog';
export type { ConfirmDialogProps, DialogContentProps } from './components/dialog';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/dropdown-menu';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from './components/tooltip';
export type { TooltipProps } from './components/tooltip';
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from './components/popover';
export { Toaster, toast } from './components/toaster';
export { Skeleton, SkeletonText } from './components/skeleton';
export { LoadingBlock, Spinner } from './components/spinner';
export { EmptyState } from './components/empty-state';
export type { EmptyStateProps } from './components/empty-state';
export { ErrorState } from './components/error-state';
export type { ErrorStateProps } from './components/error-state';
export { Alert } from './components/alert';
export type { AlertProps } from './components/alert';
export { PageHeader, PageIconProvider, SectionHeader } from './components/page-header';
export type { PageHeaderProps } from './components/page-header';
export {
  Sidebar,
  SidebarNavItem,
  SidebarNavItemContent,
  SidebarSection,
} from './components/sidebar';
export type { SidebarNavItemProps, SidebarProps, SidebarSectionProps } from './components/sidebar';
export { TopBar } from './components/top-bar';
export type { TopBarProps } from './components/top-bar';
export { StatCard } from './components/stat-card';
export type { StatCardProps } from './components/stat-card';
export { Meter } from './components/progress';
export type { MeterProps } from './components/progress';
export { Pagination } from './components/pagination';
export type { PaginationProps } from './components/pagination';
export { LogoMark, Wordmark } from './components/logo';
export { CodeBlock } from './components/code-block';
export type { CodeBlockProps } from './components/code-block';
export { JsonViewer } from './components/json-viewer';
export type { JsonViewerProps } from './components/json-viewer';

// Charts
export { BarChart } from './charts/bar-chart';
export type { BarChartProps } from './charts/bar-chart';
export { LineChart } from './charts/line-chart';
export type { LineChartProps } from './charts/line-chart';
export { AreaChart } from './charts/area-chart';
export type { AreaChartProps } from './charts/area-chart';
export { DonutChart } from './charts/donut-chart';
export type { DonutChartProps, DonutDatum } from './charts/donut-chart';
export {
  CHART_SERIES_COLORS,
  ChartFrame,
  ChartLegend,
  ChartTooltipContent,
  seriesColor,
} from './charts/chart-shared';
export type { SeriesDef, ValueFormatter } from './charts/chart-shared';
export { Sheet, SheetClose, SheetContent, SheetTrigger } from './components/sheet';
export type { SheetContentProps } from './components/sheet';

// Direction (RTL/LTR) context for Radix primitives; mount once near the app root.
export { DirectionProvider, useDirection } from '@radix-ui/react-direction';
export { UiStringsProvider, useUiStrings, defaultUiStrings } from './lib/ui-strings';
export type { UiStrings } from './lib/ui-strings';
