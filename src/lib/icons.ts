/**
 * Single entry point for every lucide-react icon used in this app.
 *
 * Why this file exists: lucide-react has a known bug (github.com/lucide-icons/lucide,
 * "Cannot read properties of undefined (reading 'map')" / "n.map is not a function")
 * that surfaces in frameworks with route-based code splitting (TanStack Start,
 * Next.js app router, Remix, etc). When many files each import icons directly
 * from "lucide-react", the bundler can end up placing partial/duplicate copies
 * of lucide's shared Icon-rendering internals into different route chunks,
 * and a copy that initializes before its icon-path data is ready crashes with
 * that error. Routing every icon import through this one module gives the
 * bundler a single, unambiguous module graph edge into lucide-react, so it
 * only ever gets bundled once.
 *
 * Import icons from here ("@/lib/icons"), never directly from "lucide-react".
 */
export type { LucideIcon } from "lucide-react";

export {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronDownIcon,
  ChevronLeft,
  ChevronLeftIcon,
  ChevronRight,
  ChevronRightIcon,
  ChevronUp,
  Circle,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Eye,
  FileMinus,
  FilePlus,
  FileText,
  GripVertical,
  HardHat,
  History,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Printer,
  Receipt,
  ReceiptText,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
  Banknote,
  IdCard,
  Upload,
  Lock,
  Unlock,
  FileSpreadsheet,
  UserPlus,
  Filter,
  RefreshCw,
  ListChecks,
  ShieldAlert,
  Info,
} from "lucide-react";
