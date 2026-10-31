// Mock native storage, session membership, scheduling and widget bridges.
import { upcomingRange as scopedUpcomingRange } from '../../features/planner/range';
export const disk = new Map();
export const kv = {
  getItemSync: (k) => disk.get(k),
  setItemSync: (k, v) => disk.set(k, v),
  removeItemSync: (k) => disk.delete(k),
  getAllKeysSync: () => [...disk.keys()],
};
export const offlineKv = kv,
  clients = [],
  effects = [];
export const unavailableCredentials = new Set();
let indexUnavailable = false;
export const setIndexUnavailable = (value) => { indexUnavailable = value; };
export const loadStoredClients = async () => clients.filter((s) => !s.account.expired && !unavailableCredentials.has(s.account.id));
export const loadStoredAccountLifetimes = async () => indexUnavailable ? null : clients
  .filter((s) => !s.account.expired)
  .map((s) => ({ accountId: s.account.id, generation: s.client }));
export const isStoredAccountLifetime = (lifetime) => !indexUnavailable && clients.some((s) =>
  s.account.id === lifetime.accountId && !s.account.expired && s.client === lifetime.generation);
export const isStoredAccountClient = (id, c) =>
  clients.some((s) => s.account.id === id && !s.account.expired && s.client === c);
export const markAccountExpired = async (id) => {
  const s = clients.find((s) => s.account.id === id);
  if (s) s.account.expired = true;
};
export const useCanvas = () => clients[0],
  useSession = () => ({ status: 'ready', active: clients[0]?.account, client: clients[0]?.client });
export const updateAccountUser = async () => {},
  useAccountKey = () => clients[0]?.account.id;
export const useCanvasQuery = () => ({}),
  useCanvasMutation = () => ({}),
  uploadToCanvas = async () => {};
export const Platform = { OS: 'ios' },
  AppState = { addEventListener: () => ({ remove() {} }) },
  useEffect = (fn) => effects.push(fn);
export const scheduled = new Map(),
  delivered = [];
export const AndroidImportance = { HIGH: 4, DEFAULT: 3, LOW: 2 }, IosAuthorizationStatus = { PROVISIONAL: 3 };
export const SchedulableTriggerInputTypes = { DATE: 'date' };
export const setNotificationHandler = () => {};
export const getPermissionsAsync = async () => ({ granted: false, canAskAgain: false });
export const requestPermissionsAsync = getPermissionsAsync;
export const getPresentedNotificationsAsync = async () => [];
export const publications = [], cancelled = [], dismissed = [];
let channelGate = null, publicationGate = null;
export const setChannelGate = (value) => { channelGate = value; };
export const setPublicationGate = (value) => { publicationGate = value; };
export const setNotificationChannelAsync = async () => { if (channelGate) await channelGate; };
export const scheduleNotificationAsync = async (request) => {
  if (publicationGate) await publicationGate;
  const id = `test-publication-${publications.length}`;
  publications.push({ id, request });
  return id;
};
export const dismissNotificationAsync = async (id) => { dismissed.push(id); };
export let schedulingGate = null,
  workGate = null;
export const setSchedulingGate = (p) => {
    schedulingGate = p;
  },
  setWorkGate = (p) => {
    workGate = p;
  };
export const getAllScheduledNotificationsAsync = async () => [...scheduled.values()];
export const cancelScheduledNotificationAsync = async (id) => {
    scheduled.delete(id);
    cancelled.push(id);
  },
  setBadgeCountAsync = async () => {};
export const scheduleAt = async (identifier, at, text, data) => {
  if (schedulingGate) await schedulingGate;
  scheduled.set(identifier, { identifier, at, text, data });
};
export const presentNow = async (text, data) => {
  delivered.push({ text, data });
  return true;
};
export const widgetWrites = [];
const widget = (name) => ({
  updateSnapshot: (props) => widgetWrites.push({ name, props }),
  updateTimeline: (entries) => widgetWrites.push({ name, props: entries[0].props }),
});
export const NextDueWidget = widget('next'),
  TodoWidget = widget('todo'),
  AnnouncementsWidget = widget('announcements'),
  GradesWidget = widget('grades');
export const work = new Map(),
  widgetItems = new Map(),
  widgetRanges = new Map();
export const fetchPlannedWork = async (c) => {
  if (workGate) await workGate;
  return work.get(c) ?? [];
};
export const fetchStreamChanges = async () => ({ grades: [], comments: [], announcements: [] }),
  fetchUnreadMessages = async () => [],
  fetchUnreadCount = async () => 0,
  fetchCourseNames = async () => ({});
export const fetchPlannerItems = async (c, range) => {
  widgetRanges.set(c, range);
  if (workGate) await workGate;
  return widgetItems.get(c) ?? [];
};
export const upcomingRange = scopedUpcomingRange,
  fetchDashboardCourses = async () => [],
  fetchGradesOverview = async () => [],
  fetchAnnouncements = async () => [];
