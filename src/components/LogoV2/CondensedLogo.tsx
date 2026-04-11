import * as React from 'react';
import { type ReactNode, useEffect } from 'react';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getEffortSuffix } from '../../utils/effort.js';
import { truncate } from '../../utils/format.js';
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js';
import { renderModelSetting } from '../../utils/model/model.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { GuestPassesUpsell, incrementGuestPassesSeenCount, useShowGuestPassesUpsell } from './GuestPassesUpsell.js';
import { incrementOverageCreditUpsellSeenCount, OverageCreditUpsell, useShowOverageCreditUpsell } from './OverageCreditUpsell.js';

// Mini CLAUDEME ASCII logo (3 lines, compact)
const MINI_LOGO = [
  " \u2588\u2588\u2588\u2557\u2588\u2557  \u2588\u2588\u2588\u2557 ",
  " \u2588\u2554\u2550\u255d\u2588\u2551  \u2588\u2554\u2550\u255d ",
  " \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557 ",
];

export function CondensedLogo(): ReactNode {
  const { columns } = useTerminalSize();
  const agent = useAppState((s) => s.agent);
  const effortValue = useAppState((s) => s.effortValue);
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings,
  } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
  const showGuestPassesUpsell = useShowGuestPassesUpsell();
  const showOverageCreditUpsell = useShowOverageCreditUpsell();

  useEffect(() => {
    if (showGuestPassesUpsell) {
      incrementGuestPassesSeenCount();
    }
  }, [showGuestPassesUpsell]);

  useEffect(() => {
    if (showOverageCreditUpsell && !showGuestPassesUpsell) {
      incrementOverageCreditUpsellSeenCount();
    }
  }, [showOverageCreditUpsell, showGuestPassesUpsell]);

  // Calculate available width for text content
  // Account for: mini logo width (17 chars) + gap (2) + padding (2) = 21 chars
  const textWidth = Math.max(columns - 21, 20);
  const truncatedVersion = truncate(version, Math.max(textWidth - 10, 6));
  const effortSuffix = getEffortSuffix(model, effortValue);
  const { shouldSplit, truncatedModel, truncatedBilling } =
    formatModelAndBilling(
      modelDisplayName + effortSuffix,
      billingType,
      textWidth,
    );
  const cwdAvailableWidth = agentName
    ? textWidth - 1 - stringWidth(agentName) - 3
    : textWidth;
  const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 10));

  return (
    <OffscreenFreeze>
      <Box flexDirection="row" gap={2} alignItems="center">
        {/* ClaudeMe mini ASCII logo */}
        <Box flexDirection="column">
          {MINI_LOGO.map((line, i) => (
            <Text key={i} color="claude">{line}</Text>
          ))}
        </Box>

        {/* Info */}
        <Box flexDirection="column">
          <Text>
            <Text bold={true}>ClaudeMe</Text>{" "}
            <Text dimColor={true}>v{truncatedVersion}</Text>
          </Text>
          {shouldSplit ? (
            <>
              <Text dimColor={true}>{truncatedModel}</Text>
              <Text dimColor={true}>{truncatedBilling}</Text>
            </>
          ) : (
            <Text dimColor={true}>
              {truncatedModel} · {truncatedBilling}
            </Text>
          )}
          <Text dimColor={true}>
            {agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd}
          </Text>
          {showGuestPassesUpsell && <GuestPassesUpsell />}
          {!showGuestPassesUpsell && showOverageCreditUpsell && (
            <OverageCreditUpsell maxWidth={textWidth} twoLine={true} />
          )}
        </Box>
      </Box>
    </OffscreenFreeze>
  );
}
