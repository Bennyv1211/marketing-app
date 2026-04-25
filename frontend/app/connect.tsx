import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Button from "../components/Button";
import { theme } from "../lib/theme";
import { api } from "../lib/api";

WebBrowser.maybeCompleteAuthSession();

type Conn = { platform: string; account_name: string; status: string };
type MetaOption = {
  page_id: string;
  page_name: string;
  instagram_account?: { id: string; username?: string; name?: string } | null;
};

export default function Connect() {
  const router = useRouter();
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTikTokModal, setShowTikTokModal] = useState(false);
  const [handle, setHandle] = useState("");
  const [working, setWorking] = useState(false);
  const [metaSelectionId, setMetaSelectionId] = useState<string | null>(null);
  const [metaRequestedPlatform, setMetaRequestedPlatform] = useState<"instagram" | "facebook" | null>(null);
  const [metaOptions, setMetaOptions] = useState<MetaOption[]>([]);

  const load = async () => {
    try {
      setLoading(true);
      const rows = (await api.listConnections()) as Conn[];
      setConns(rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const connected = (platform: string) => conns.find((c) => c.platform === platform && c.status === "connected");

  const onConnectMeta = async (platform: "instagram" | "facebook") => {
    setWorking(true);
    try {
      const appRedirectUri = Linking.createURL("connect");
      const { auth_url } = (await api.startMetaConnect(platform, appRedirectUri)) as { auth_url: string };
      const result = await WebBrowser.openAuthSessionAsync(auth_url, appRedirectUri);

      if (result.type === "success" && result.url) {
        const parsed = Linking.parse(result.url);
        const status = typeof parsed.queryParams?.status === "string" ? parsed.queryParams.status : "";
        const message = typeof parsed.queryParams?.message === "string" ? parsed.queryParams.message : "";
        const selectionId = typeof parsed.queryParams?.selection_id === "string" ? parsed.queryParams.selection_id : "";
        if (status === "error") {
          Alert.alert("Connection failed", message || "Meta connection did not complete.");
        } else if (status === "select" && selectionId) {
          const optionsPayload = (await api.getMetaConnectionOptions(selectionId)) as {
            id: string;
            requested_platform: "instagram" | "facebook";
            options: MetaOption[];
          };
          setMetaSelectionId(optionsPayload.id);
          setMetaRequestedPlatform(optionsPayload.requested_platform);
          setMetaOptions(optionsPayload.options || []);
        }
      }

      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta connection did not complete.";
      Alert.alert("Connection failed", message);
    } finally {
      setWorking(false);
    }
  };

  const onConnectTikTok = async () => {
    if (!handle.trim()) return;
    setWorking(true);
    try {
      await api.connectSocial("tiktok", handle.trim());
      setShowTikTokModal(false);
      setHandle("");
      await load();
    } finally {
      setWorking(false);
    }
  };

  const onSelectMetaAccount = async (pageId: string) => {
    if (!metaSelectionId) return;
    setWorking(true);
    try {
      await api.selectMetaConnectionOption(metaSelectionId, pageId);
      setMetaSelectionId(null);
      setMetaRequestedPlatform(null);
      setMetaOptions([]);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the selected Meta account.";
      Alert.alert("Selection failed", message);
    } finally {
      setWorking(false);
    }
  };

  const onDisconnect = async (platform: string) => {
    setWorking(true);
    try {
      await api.disconnectSocial(platform);
      await load();
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
        </TouchableOpacity>

        <Text style={styles.title}>Connect your accounts</Text>
        <Text style={styles.subtitle}>
          Link your Instagram, Facebook, and TikTok accounts so we can publish posts for you.
        </Text>

        <PlatformCard
          platform="instagram"
          title="Instagram"
          subtitle="Primary - real Meta business login"
          icon="logo-instagram"
          color="#E1306C"
          conn={connected("instagram")}
          onConnect={() => onConnectMeta("instagram")}
          onDisconnect={() => onDisconnect("instagram")}
          working={working || loading}
        />
        <PlatformCard
          platform="facebook"
          title="Facebook"
          subtitle="Optional - real Meta Page connection"
          icon="logo-facebook"
          color="#1877F2"
          conn={connected("facebook")}
          onConnect={() => onConnectMeta("facebook")}
          onDisconnect={() => onDisconnect("facebook")}
          working={working || loading}
        />
        <PlatformCard
          platform="tiktok"
          title="TikTok"
          subtitle="Temporary manual test connection"
          icon="musical-notes"
          color="#111111"
          conn={connected("tiktok")}
          onConnect={() => setShowTikTokModal(true)}
          onDisconnect={() => onDisconnect("tiktok")}
          working={working || loading}
        />

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.text600} />
          <Text style={styles.noteText}>
            Instagram and Facebook now connect through real Meta OAuth. TikTok is still a temporary manual test connection while we finish its direct integration.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={showTikTokModal} transparent animationType="slide" onRequestClose={() => setShowTikTokModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Connect TikTok</Text>
            <Text style={styles.modalSub}>Enter your TikTok handle for the temporary test connection.</Text>
            <TextInput
              placeholder="@yourtiktok"
              placeholderTextColor={theme.colors.text400}
              value={handle}
              onChangeText={setHandle}
              style={styles.input}
              autoCapitalize="none"
              testID="connect-handle-input"
            />
            <View style={{ height: 12 }} />
            <Button
              label="Connect"
              onPress={onConnectTikTok}
              loading={working}
              disabled={!handle.trim()}
              testID="connect-submit"
            />
            <View style={{ height: 8 }} />
            <Button label="Cancel" variant="secondary" onPress={() => setShowTikTokModal(false)} testID="connect-cancel" />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!metaSelectionId} transparent animationType="slide" onRequestClose={() => setMetaSelectionId(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Choose your {metaRequestedPlatform === "instagram" ? "Instagram account" : "Facebook Page"}</Text>
            <Text style={styles.modalSub}>
              We found more than one eligible Meta account. Pick the Page you want AdFlow to use.
            </Text>
            <ScrollView style={styles.optionList} contentContainerStyle={{ gap: 10 }}>
              {metaOptions.map((option) => (
                <TouchableOpacity
                  key={option.page_id}
                  style={styles.optionCard}
                  onPress={() => onSelectMetaAccount(option.page_id)}
                  disabled={working}
                >
                  <Text style={styles.optionTitle}>{option.page_name}</Text>
                  <Text style={styles.optionSub}>
                    {option.instagram_account
                      ? `Instagram: @${option.instagram_account.username || option.instagram_account.name || "linked"}`
                      : "No linked Instagram business account"}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ height: 8 }} />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setMetaSelectionId(null);
                setMetaRequestedPlatform(null);
                setMetaOptions([]);
              }}
              testID="meta-select-cancel"
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function PlatformCard({
  platform,
  title,
  subtitle,
  icon,
  color,
  conn,
  onConnect,
  onDisconnect,
  working,
}: {
  platform: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  conn?: Conn;
  onConnect: () => void;
  onDisconnect: () => void;
  working: boolean;
}) {
  const isOn = !!conn;

  return (
    <View style={styles.card} testID={`platform-${platform}`}>
      <View style={styles.cardHeader}>
        <View style={[styles.platformIcon, { backgroundColor: `${color}22` }]}>
          <Ionicons name={icon} size={26} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: isOn ? theme.colors.primaryLight : theme.colors.border }]}>
          <View style={[styles.dot, { backgroundColor: isOn ? theme.colors.success : theme.colors.text400 }]} />
          <Text style={[styles.badgeText, { color: isOn ? theme.colors.success : theme.colors.text600 }]}>
            {isOn ? "Connected" : "Not connected"}
          </Text>
        </View>
      </View>

      {isOn ? (
        <>
          <Text style={styles.accountText}>{conn.account_name}</Text>
          <Button label="Disconnect" variant="secondary" onPress={onDisconnect} disabled={working} testID={`disconnect-${platform}`} />
        </>
      ) : (
        <Button label={`Connect ${title}`} onPress={onConnect} loading={working} testID={`connect-${platform}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    ...theme.shadow.card,
  },
  title: { fontSize: 26, fontWeight: "800", color: theme.colors.text900, marginBottom: 6 },
  subtitle: { fontSize: 15, color: theme.colors.text600, marginBottom: 20 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    ...theme.shadow.card,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  platformIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text900 },
  cardSub: { fontSize: 12, color: theme.colors.text600, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  accountText: { fontSize: 14, color: theme.colors.text800, fontWeight: "600", marginBottom: 10 },
  note: {
    marginTop: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.primaryLight,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noteText: { flex: 1, color: theme.colors.text800, fontSize: 13 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modal: { backgroundColor: "#fff", padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: theme.colors.text900, marginBottom: 4 },
  modalSub: { fontSize: 14, color: theme.colors.text600, marginBottom: 14 },
  input: {
    minHeight: 56,
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.colors.text900,
  },
  optionList: {
    maxHeight: 260,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#fff",
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.colors.text900,
    marginBottom: 4,
  },
  optionSub: {
    fontSize: 13,
    color: theme.colors.text600,
  },
});
