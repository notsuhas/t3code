import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ScheduledPromptSummary } from "@t3tools/contracts";
import { useMemo, useState, type ComponentProps } from "react";
import { Alert, FlatList, Platform, Pressable, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SymbolView } from "../../components/AppSymbol";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { scheduledPromptEnvironment } from "../../state/scheduledPrompts";
import { useAtomCommand } from "../../state/use-atom-command";

export function ScheduledPromptsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const supported = useMemo(
    () =>
      environments.filter(
        (environment) =>
          environment.connection.phase === "connected" &&
          environment.serverConfig?.environment.capabilities.scheduledPrompts === true,
      ),
    [environments],
  );
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const environment =
    supported.find((entry) => entry.environmentId === selectedId) ?? supported[0] ?? null;
  const environmentId = environment?.environmentId ?? null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : scheduledPromptEnvironment.list({ environmentId, input: {} }),
  );
  const runNow = useAtomCommand(scheduledPromptEnvironment.runNow);
  const setEnabled = useAtomCommand(scheduledPromptEnvironment.setEnabled);
  const deleteSchedule = useAtomCommand(scheduledPromptEnvironment.delete);
  const [busyId, setBusyId] = useState<string | null>(null);

  const perform = async (schedule: ScheduledPromptSummary, action: () => Promise<unknown>) => {
    setBusyId(schedule.id);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  };

  const renderSchedule = ({ item }: { readonly item: ScheduledPromptSummary }) => (
    <View className="border-b border-separator px-5 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-t3-semibold text-base text-foreground" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="mt-1 text-sm text-foreground-muted" numberOfLines={2}>
            {formatNextRun(item)}
          </Text>
        </View>
        <View
          className={
            item.enabled
              ? "rounded-full bg-adaptive-emerald-500-a12-a16 px-2.5 py-1"
              : "rounded-full bg-fill-quaternary px-2.5 py-1"
          }
        >
          <Text
            className={
              item.enabled
                ? "font-t3-bold text-2xs text-adaptive-emerald-700-300"
                : "font-t3-bold text-2xs text-foreground-muted"
            }
          >
            {item.enabled ? "Enabled" : "Paused"}
          </Text>
        </View>
      </View>
      <Text className="mt-2 text-xs text-foreground-muted" numberOfLines={1}>
        {item.modelSelection.instanceId} · {item.modelSelection.model}
      </Text>
      {item.lastRun ? (
        <Pressable
          accessibilityRole={item.lastRun.threadId ? "button" : undefined}
          className="mt-3 flex-row items-center gap-2 rounded-xl bg-fill-quaternary px-3 py-2.5"
          disabled={!item.lastRun.threadId}
          onPress={() => {
            if (!item.lastRun?.threadId || !environmentId) return;
            navigation.navigate("Thread", {
              environmentId: String(environmentId),
              threadId: String(item.lastRun.threadId),
            });
          }}
        >
          <SymbolView name="clock" size={16} tintColorClassName="accent-icon" />
          <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
            Last run: {item.lastRun.state}
          </Text>
          {item.lastRun.threadId ? (
            <SymbolView name="chevron.right" size={13} tintColorClassName="accent-chevron" />
          ) : null}
        </Pressable>
      ) : null}
      <View className="mt-3 flex-row gap-2">
        <ActionButton
          disabled={busyId === item.id || item.activeRunId !== null}
          icon="play"
          label={item.activeRunId ? "Running" : "Run now"}
          onPress={() =>
            environmentId &&
            void perform(item, () => runNow({ environmentId, input: { id: item.id } }))
          }
        />
        <ActionButton
          disabled={busyId === item.id}
          icon={item.enabled ? "stop.fill" : "play"}
          label={item.enabled ? "Pause" : "Enable"}
          onPress={() =>
            environmentId &&
            void perform(item, () =>
              setEnabled({ environmentId, input: { id: item.id, enabled: !item.enabled } }),
            )
          }
        />
        <ActionButton
          destructive
          disabled={busyId === item.id}
          icon="trash"
          label="Delete"
          onPress={() => {
            if (!environmentId) return;
            Alert.alert("Delete scheduled prompt?", `Delete “${item.name}”?`, [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () =>
                  void perform(item, async () => {
                    await deleteSchedule({ environmentId, input: { id: item.id } });
                  }),
              },
            ]);
          }}
        />
      </View>
    </View>
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Scheduled Prompts" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      {supported.length > 1 ? (
        <View className="border-b border-separator px-5 py-3">
          <FlatList
            horizontal
            data={supported}
            keyExtractor={(item) => item.environmentId}
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                className={
                  item.environmentId === environmentId
                    ? "rounded-full bg-accent px-3 py-2"
                    : "rounded-full bg-fill-quaternary px-3 py-2"
                }
                onPress={() => setSelectedId(item.environmentId)}
              >
                <Text
                  className={
                    item.environmentId === environmentId
                      ? "font-t3-semibold text-sm text-accent-foreground"
                      : "font-t3-semibold text-sm text-foreground"
                  }
                >
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      {query.error ? (
        <View className="px-5 pt-4">
          <ErrorBanner message={query.error} />
        </View>
      ) : null}
      <FlatList
        data={query.data?.schedules ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderSchedule}
        refreshControl={<RefreshControl refreshing={query.isPending} onRefresh={query.refresh} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18, flexGrow: 1 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center px-8">
            <SymbolView name="clock" size={30} tintColorClassName="accent-icon" />
            <Text className="mt-4 font-t3-semibold text-lg text-foreground">
              {supported.length === 0 ? "Schedules unavailable" : "No scheduled prompts"}
            </Text>
            <Text className="mt-2 text-center text-sm leading-5 text-foreground-muted">
              {supported.length === 0
                ? "Connect to an updated T3 Code environment."
                : "Create and edit schedules from the web or desktop app."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  destructive,
  disabled,
  onPress,
}: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={
        disabled
          ? "flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-fill-quaternary px-2 py-2.5 opacity-50"
          : destructive
            ? "flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-danger px-2 py-2.5"
            : "flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-fill-quaternary px-2 py-2.5"
      }
      onPress={onPress}
    >
      <SymbolView
        name={icon}
        size={14}
        tintColorClassName={destructive ? "accent-danger-foreground" : "accent-icon"}
      />
      <Text
        className={
          destructive
            ? "font-t3-semibold text-xs text-danger-foreground"
            : "font-t3-semibold text-xs text-foreground"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function formatNextRun(schedule: ScheduledPromptSummary): string {
  if (!schedule.enabled) return "Paused";
  if (!schedule.nextRunAt) return "No next run";
  return `Next: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: schedule.timezone }).format(new Date(schedule.nextRunAt))}`;
}
