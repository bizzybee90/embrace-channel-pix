import { Conversation } from '@/lib/types';

/**
 * Tablet layout view states
 * - 'list': Shows ticket list (State 1)
 * - 'conversation': Shows conversation detail (State 2)
 */
export type TabletViewState = 'list' | 'conversation';

/**
 * Drawer modes for slide-over panels on tablet
 * - 'customer': Customer info panel
 * - 'actions': Quick actions panel
 * - null: No drawer open
 */
export type DrawerMode = 'customer' | 'actions' | null;

/**
 * Complete tablet layout state
 */
export interface TabletLayoutState {
  viewState: TabletViewState;
  selectedConversation: Conversation | null;
  drawerMode: DrawerMode;
  isScrolled: boolean;
}
