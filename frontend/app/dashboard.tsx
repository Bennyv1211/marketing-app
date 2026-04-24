import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../components/Button";
import { theme } from "../lib/theme";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useWizard } from "../lib/WizardContext";

export default function Dashboard() {
  const router = useRouter();
  const { user, business, signOut } = useAuth();
  const { reset } = useWizard();
  const [summary, setSummary] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.dashboard(), api.listPosts()]);
      setSummary(s);
      setPosts(p as any[]);
    } catch (e) {
      // keep silent, show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const startCreate = () => {
    reset();
    router.push("/create/upload");
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>Hi{user?.full_name ? `, ${user.full_name}` : ""} 👋</Text>
            <Text style={styles.bizName} testID="dashboard-biz-name">
              {business?.business_name || "Your business"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/connect")}
            style={styles.iconBtn}
            testID="go-connect"
          >
            <Ionicons name="link-outline" size={22} color={theme.colors.text800} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => { await signOut(); router.replace("/"); }}
            style={styles.iconBtn}
            testID="sign-out"
          >
            <Ionicons name="log-out-outline" size={22} color={theme.colors.text800} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={startCreate}
          activeOpacity={0.9}
          style={styles.ctaCard}
          testID="create-post-cta"
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="sparkles" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Create a post</Text>
            <Text style={styles.ctaSub}>Upload a photo and we'll design it for you</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#fff" />
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.metricsRow}>
              <MetricBox label="Total posts" value={String(summary?.total_posts ?? 0)} testID="metric-total" />
              <MetricBox label="Total reach" value={String(summary?.total_reach ?? 0)} testID="metric-reach" />
              <MetricBox label="Total likes" value={String(summary?.total_likes ?? 0)} testID="metric-likes" />
            </View>

            {summary?.most_recent ? (
              <Text style={styles.friendly} testID="friendly-summary">
                ✨ Your last post reached {summary.most_recent.metrics_total?.reach ?? 0} people.
              </Text>
            ) : null}

            {summary?.best_performing ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your best post so far</Text>
                <PostCard post={summary.best_performing} onPress={() => {}} />
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent posts</Text>
              {posts.length === 0 ? (
                <View style={styles.empty} testID="empty-posts">
                  <Ionicons name="image-outline" size={40} color={theme.colors.text400} />
                  <Text style={styles.emptyTitle}>No posts yet</Text>
                  <Text style={styles.emptySub}>Tap "Create a post" to make your first one.</Text>
                </View>
              ) : (
                posts.map((p) => <PostCard key={p.id} post={p} onPress={() => {}} />)
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricBox({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.metricBox} testID={testID}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function PostCard({ post, onPress }: { post: any; onPress: () => void }) {
  const caption = post.caption_text || "";
  const snippet = caption.length > 90 ? caption.slice(0, 90) + "…" : caption;
  const date = post.published_at || post.created_at || "";
  const dateStr = date ? new Date(date).toLocaleDateString() : "";
  const platforms: string[] = [];
  if (post.instagram_enabled) platforms.push("Instagram");
  if (post.facebook_enabled) platforms.push("Facebook");
  if (post.tiktok_enabled) platforms.push("TikTok");
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.postCard} testID={`post-${post.id}`}>
      {post.image_data_uri ? (
        <Image source={{ uri: post.image_data_uri }} style={styles.postImg} />
      ) : (
        <View style={[styles.postImg, { backgroundColor: theme.colors.border }]} />
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.postSnippet} numberOfLines={2}>{snippet || "(no caption)"}</Text>
        <Text style={styles.postMeta}>
          {dateStr}{dateStr && platforms.length ? " · " : ""}{platforms.join(", ")}
        </Text>
        <View style={styles.postStats}>
          <Stat icon="eye-outline" v={post.metrics_total?.reach} />
          <Stat icon="heart-outline" v={post.metrics_total?.likes} />
          <Stat icon="chatbubble-outline" v={post.metrics_total?.comments} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Stat({ icon, v }: { icon: any; v: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: 12 }}>
      <Ionicons name={icon} size={14} color={theme.colors.text600} />
      <Text style={{ marginLeft: 4, fontSize: 12, color: theme.colors.text600, fontWeight: "600" }}>
        {v ?? 0}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  hi: { fontSize: 15, color: theme.colors.text600 },
  bizName: { fontSize: 24, fontWeight: "800", color: theme.colors.text900 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginLeft: 8, ...theme.shadow.card,
  },
  ctaCard: {
    backgroundColor: theme.colors.primary,
    borderRadius: 24,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    ...theme.shadow.card,
    shadowOpacity: 0.15,
  },
  ctaIcon: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  ctaTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  ctaSub: { color: "rgba(255,255,255,0.88)", fontSize: 13, marginTop: 2 },
  metricsRow: { flexDirection: "row", gap: 10, marginTop: 22 },
  metricBox: {
    flex: 1, backgroundColor: "#fff", borderRadius: 20, padding: 14, alignItems: "center",
    ...theme.shadow.card,
  },
  metricValue: { fontSize: 22, fontWeight: "800", color: theme.colors.text900 },
  metricLabel: { fontSize: 12, color: theme.colors.text600, marginTop: 2 },
  friendly: {
    marginTop: 18, padding: 14, borderRadius: 16, backgroundColor: theme.colors.primaryLight,
    color: theme.colors.text800, fontWeight: "600", fontSize: 14,
  },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text900, marginBottom: 12 },
  postCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 20, padding: 12, marginBottom: 10, ...theme.shadow.card,
  },
  postImg: { width: 70, height: 70, borderRadius: 14 },
  postSnippet: { fontSize: 14, color: theme.colors.text900, fontWeight: "600" },
  postMeta: { fontSize: 12, color: theme.colors.text600, marginTop: 4 },
  postStats: { flexDirection: "row", marginTop: 8 },
  empty: {
    alignItems: "center", padding: 30, backgroundColor: "#fff", borderRadius: 24, ...theme.shadow.card,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.text800, marginTop: 10 },
  emptySub: { fontSize: 13, color: theme.colors.text600, textAlign: "center", marginTop: 4 },
});
