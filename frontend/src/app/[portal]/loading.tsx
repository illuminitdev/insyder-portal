import { LoadingState } from "@/components/common/LoadingState";

/**
 * Shown the moment a section is clicked, inside the shell (menu and top bar stay), while the
 * next page loads. Without it the old page stays on screen and the click looks like it did nothing.
 */
export default function PortalLoading() {
  return <LoadingState />;
}
