import Activity from '@lucide/svelte/icons/activity'
import Archive from '@lucide/svelte/icons/archive'
import BadgeCheck from '@lucide/svelte/icons/badge-check'
import Bell from '@lucide/svelte/icons/bell'
import BookOpen from '@lucide/svelte/icons/book-open'
import Bot from '@lucide/svelte/icons/bot'
import Box from '@lucide/svelte/icons/box'
import Boxes from '@lucide/svelte/icons/boxes'
import Brain from '@lucide/svelte/icons/brain'
import Briefcase from '@lucide/svelte/icons/briefcase'
import Bug from '@lucide/svelte/icons/bug'
import Building from '@lucide/svelte/icons/building'
import Calendar from '@lucide/svelte/icons/calendar'
import ChartLine from '@lucide/svelte/icons/chart-line'
import CircleDot from '@lucide/svelte/icons/circle-dot'
import ClipboardList from '@lucide/svelte/icons/clipboard-list'
import Clock from '@lucide/svelte/icons/clock'
import Cloud from '@lucide/svelte/icons/cloud'
import Code from '@lucide/svelte/icons/code'
import Cog from '@lucide/svelte/icons/cog'
import Container from '@lucide/svelte/icons/container'
import Cpu from '@lucide/svelte/icons/cpu'
import CreditCard from '@lucide/svelte/icons/credit-card'
import Database from '@lucide/svelte/icons/database'
import DraftingCompass from '@lucide/svelte/icons/drafting-compass'
import Eye from '@lucide/svelte/icons/eye'
import File from '@lucide/svelte/icons/file'
import FileCheck from '@lucide/svelte/icons/file-check'
import FileSearch from '@lucide/svelte/icons/file-search'
import FileText from '@lucide/svelte/icons/file-text'
import FingerprintPattern from '@lucide/svelte/icons/fingerprint-pattern'
import Flag from '@lucide/svelte/icons/flag'
import FlaskConical from '@lucide/svelte/icons/flask-conical'
import Folder from '@lucide/svelte/icons/folder'
import FolderGit2 from '@lucide/svelte/icons/folder-git-2'
import Gauge from '@lucide/svelte/icons/gauge'
import Gavel from '@lucide/svelte/icons/gavel'
import GitBranch from '@lucide/svelte/icons/git-branch'
import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal'
import GitPullRequest from '@lucide/svelte/icons/git-pull-request'
import Globe from '@lucide/svelte/icons/globe'
import Handshake from '@lucide/svelte/icons/handshake'
import HardDrive from '@lucide/svelte/icons/hard-drive'
import Hash from '@lucide/svelte/icons/hash'
import Inbox from '@lucide/svelte/icons/inbox'
import KeyRound from '@lucide/svelte/icons/key-round'
import Landmark from '@lucide/svelte/icons/landmark'
import Layers from '@lucide/svelte/icons/layers'
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard'
import Library from '@lucide/svelte/icons/library'
import Lightbulb from '@lucide/svelte/icons/lightbulb'
import Link from '@lucide/svelte/icons/link'
import ListChecks from '@lucide/svelte/icons/list-checks'
import Lock from '@lucide/svelte/icons/lock'
import Mail from '@lucide/svelte/icons/mail'
import Map from '@lucide/svelte/icons/map'
import Megaphone from '@lucide/svelte/icons/megaphone'
import MessageSquare from '@lucide/svelte/icons/message-square'
import Milestone from '@lucide/svelte/icons/milestone'
import Monitor from '@lucide/svelte/icons/monitor'
import Network from '@lucide/svelte/icons/network'
import Package from '@lucide/svelte/icons/package'
import Plug from '@lucide/svelte/icons/plug'
import Puzzle from '@lucide/svelte/icons/puzzle'
import Radio from '@lucide/svelte/icons/radio'
import Receipt from '@lucide/svelte/icons/receipt'
import Rocket from '@lucide/svelte/icons/rocket'
import Route from '@lucide/svelte/icons/route'
import Scale from '@lucide/svelte/icons/scale'
import ScrollText from '@lucide/svelte/icons/scroll-text'
import Server from '@lucide/svelte/icons/server'
import Settings from '@lucide/svelte/icons/settings'
import Shield from '@lucide/svelte/icons/shield'
import ShieldCheck from '@lucide/svelte/icons/shield-check'
import ShoppingCart from '@lucide/svelte/icons/shopping-cart'
import Siren from '@lucide/svelte/icons/siren'
import Smartphone from '@lucide/svelte/icons/smartphone'
import Sparkles from '@lucide/svelte/icons/sparkles'
import Stamp from '@lucide/svelte/icons/stamp'
import Star from '@lucide/svelte/icons/star'
import Tag from '@lucide/svelte/icons/tag'
import Target from '@lucide/svelte/icons/target'
import Terminal from '@lucide/svelte/icons/terminal'
import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
import User from '@lucide/svelte/icons/user'
import Users from '@lucide/svelte/icons/users'
import Workflow from '@lucide/svelte/icons/workflow'
import Wrench from '@lucide/svelte/icons/wrench'
import Zap from '@lucide/svelte/icons/zap'
import { type IconName, iconFor } from '../../../docket/src/ontology/icons.js'

/** Every icon an ontology may name, by Lucide name - the list docket validates against. */
export const ICONS: Record<IconName, typeof Activity> = {
  activity: Activity,
  archive: Archive,
  'badge-check': BadgeCheck,
  bell: Bell,
  'book-open': BookOpen,
  bot: Bot,
  box: Box,
  boxes: Boxes,
  brain: Brain,
  briefcase: Briefcase,
  bug: Bug,
  building: Building,
  calendar: Calendar,
  'chart-line': ChartLine,
  'circle-dot': CircleDot,
  'clipboard-list': ClipboardList,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  cog: Cog,
  container: Container,
  cpu: Cpu,
  'credit-card': CreditCard,
  database: Database,
  'drafting-compass': DraftingCompass,
  eye: Eye,
  file: File,
  'file-check': FileCheck,
  'file-search': FileSearch,
  'file-text': FileText,
  'fingerprint-pattern': FingerprintPattern,
  flag: Flag,
  'flask-conical': FlaskConical,
  folder: Folder,
  'folder-git-2': FolderGit2,
  gauge: Gauge,
  gavel: Gavel,
  'git-branch': GitBranch,
  'git-commit-horizontal': GitCommitHorizontal,
  'git-pull-request': GitPullRequest,
  globe: Globe,
  handshake: Handshake,
  'hard-drive': HardDrive,
  hash: Hash,
  inbox: Inbox,
  'key-round': KeyRound,
  landmark: Landmark,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  library: Library,
  lightbulb: Lightbulb,
  link: Link,
  'list-checks': ListChecks,
  lock: Lock,
  mail: Mail,
  map: Map,
  megaphone: Megaphone,
  'message-square': MessageSquare,
  milestone: Milestone,
  monitor: Monitor,
  network: Network,
  package: Package,
  plug: Plug,
  puzzle: Puzzle,
  radio: Radio,
  receipt: Receipt,
  rocket: Rocket,
  route: Route,
  scale: Scale,
  'scroll-text': ScrollText,
  server: Server,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  siren: Siren,
  smartphone: Smartphone,
  sparkles: Sparkles,
  stamp: Stamp,
  star: Star,
  tag: Tag,
  target: Target,
  terminal: Terminal,
  'triangle-alert': TriangleAlert,
  user: User,
  users: Users,
  workflow: Workflow,
  wrench: Wrench,
  zap: Zap
}

/** The icon a type is drawn with: what the server resolved, else what docket would resolve. */
export const iconOf = (type: string, resolved?: string): typeof Activity => ICONS[iconFor(type, resolved)]
