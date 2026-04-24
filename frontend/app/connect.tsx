import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../components/Button";
import { theme } from "../lib/theme";
import { api } from "../lib/api";

type Conn = { platform: string; account_name: string; status: string };
type ConnectPlatform = "instagram" | "facebook" | "tiktok";

export default function Connect() {
  const router = useRouter();
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<null | ConnectPlatform>(null);
  const [handle, setHandle] = useState("");
  const [working, setWorking] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const rows = (await api.listConnections()) as Conn[];
      setConns(rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const connected = (p: string) => conns.find((c) => c.platform === p && c.status === "connected");

  const onConnect = async () => {
    if (!showModal || !handle.trim()) return;
    setWorking(true);
    try {
      await api.connectSocial(showModal, handle.trim());
      setShowModal(null);
      setHandle("");
      await load();
    } finally {
      setWorking(false);
    }
  };

  const onDisconnect = async (platform: string) => {
    await api.disconnectSocial(platform);
    await load();
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
          subtitle="Primary — where your posts go live"
          icon="logo-instagram"
          color="#E1306C"
          conn={connected("instagram")}
          onConnect={() => setShowModal("instagram")}
          onDisconnect={() => onDisconnect("instagram")}
        />
        <PlatformCard
          platform="facebook"
          title="Facebook"
          subtitle="Optional — share to your Facebook Page"
          icon="logo-facebook"
          color="#1877F2"
          conn={connected("facebook")}
          onConnect={() => setShowModal("facebook")}
          onDisconnect={() => onDisconnect("facebook")}
        />

        <PlatformCard
          platform="tiktok"
          title="TikTok"
          subtitle="Optional - publish short-form promo posts"
          icon="musical-notes"
          color="#111111"
          conn={connected("tiktok")}
          onConnect={() => setShowModal("tiktok")}
          onDisconnect={() => onDisconnect("tiktok")}
        />

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.text600} />
          <Text style={styles.noteText}>
            Connections are simulated in this preview. Enter any account handle to connect.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={!!showModal} transparent animationType="slide" onRequestClose={() => setShowModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              Connect {showModal === "instagram" ? "Instagram" : showModal === "facebook" ? "Facebook" : "TikTok"}
            </Text>
            <Text style={styles.modalSub}>Enter your account handle or page name.</Text>
            <TextInput
              placeholder={showModal === "instagram" ? "@yourbusiness" : showModal === "facebook" ? "Your Page name" : "@yourtiktok"}
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
              onPress={onConnect}
              loading={working}
              disabled={!handle.trim()}
              testID="connect-submit"
            />
            <View style={{ height: 8 }} />
            <Button label="Cancel" variant="secondary" onPress={() => setShowModal(null)} testID="connect-cancel" />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function PlatformCard({ platform, title, subtitle, icon, color, conn, onConnect, onDisconnect }: any) {
  const isOn = !!conn;
  return (
    <View style={styles.card} testID={`platform-${platform}`}>
      <View style={styles.cardHeader}>
        <View style={[styles.platformIcon, { backgroundColor: color + "22" }]}>
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
          <Button label="Disconnect" variant="secondary" onPress={onDisconnect} testID={`disconnect-${platform}`} />
        </>
      ) : (
        <Button label={`Connect ${title}`} onPress={onConnect} testID={`connect-${platform}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  back: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginBottom: 16, ...theme.shadow.card,
  },
  title: { fontSize: 26, fontWeight: "800", color: theme.colors.text900, marginBottom: 6 },
  subtitle: { fontSize: 15, color: theme.colors.text600, marginBottom: 20 },
  card: {
    backgroundColor: "#fff", borderRadius: 24, padding: 18, marginBottom: 14, ...theme.shadow.card,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  platformIcon: {
    width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text900 },
  cardSub: { fontSize: 12, color: theme.colors.text600, marginTop: 2 },
  badge: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  accountText: { fontSize: 14, color: theme.colors.text800, fontWeight: "600", marginBottom: 10 },
  note: {
    marginTop: 10, padding: 14, borderRadius: 16, backgroundColor: theme.colors.primaryLight,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  noteText: { flex: 1, color: theme.colors.text800, fontSize: 13 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modal: { backgroundColor: "#fff", padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: theme.colors.text900, marginBottom: 4 },
  modalSub: { fontSize: 14, color: theme.colors.text600, marginBottom: 14 },
  input: {
    minHeight: 56, borderRadius: theme.radius.lg, borderWidth: 2, borderColor: theme.colors.border,
    backgroundColor: "#fff", paddingHorizontal: 16, fontSize: 16, color: theme.colors.text900,
  },
});
