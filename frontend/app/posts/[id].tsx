import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../../lib/theme";
import { api } from "../../lib/api";

export default function PostDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const postId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!postId) {
      setErr("Post not found.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setErr(null);
      const data = await api.getPost(postId);
      setPost(data);
    } catch (e: any) {
      setErr(e?.message || "Could not load this post.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [postId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const platforms: string[] = [];
  if (post?.instagram_enabled) platforms.push("Instagram");
  if (post?.facebook_enabled) platforms.push("Facebook");
  if (post?.tiktok_enabled) platforms.push("TikTok");

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
        ) : err || !post ? (
          <View style={styles.card}>
            <Text style={styles.title}>Couldn&apos;t load post</Text>
            <Text style={styles.subtle}>{err || "Please try again."}</Text>
          </View>
        ) : (
          <>
            {post.image_data_uri ? <Image source={{ uri: post.image_data_uri }} style={styles.hero} /> : null}

            <View style={styles.card}>
              <Text style={styles.title}>Post details</Text>
              <Text style={styles.subtle}>
                {platforms.join(", ") || "No platform selected"}
                {post.publish_status ? ` - ${post.publish_status}` : ""}
              </Text>
              <Text style={styles.caption}>{post.caption_text || "(no caption)"}</Text>
              {post.caption_cta ? <Text style={styles.cta}>{post.caption_cta}</Text> : null}
              {post.caption_hashtags?.length ? (
                <Text style={styles.tags}>{post.caption_hashtags.join(" ")}</Text>
              ) : null}
            </View>

            <View style={styles.metricsRow}>
              <MetricCard label="Reach" value={post.metrics_total?.reach} />
              <MetricCard label="Likes" value={post.metrics_total?.likes} />
              <MetricCard label="Comments" value={post.metrics_total?.comments} />
            </View>

            <View style={styles.metricsRow}>
              <MetricCard label="Impressions" value={post.metrics_total?.impressions} />
              <MetricCard label="Clicks" value={post.metrics_total?.clicks} />
              <MetricCard label="Style" value={post.image_style || "-"} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value ?? 0}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
    marginBottom: 14,
    ...theme.shadow.card,
  },
  hero: {
    width: "100%",
    height: 320,
    borderRadius: 24,
    backgroundColor: theme.colors.border,
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 18,
    ...theme.shadow.card,
  },
  title: { fontSize: 22, fontWeight: "800", color: theme.colors.text900 },
  subtle: { fontSize: 13, color: theme.colors.text600, marginTop: 6, marginBottom: 14 },
  caption: { fontSize: 16, color: theme.colors.text800, lineHeight: 24 },
  cta: { fontSize: 15, color: theme.colors.primary, fontWeight: "800", marginTop: 12 },
  tags: { fontSize: 13, color: theme.colors.secondary, fontWeight: "700", marginTop: 10 },
  metricsRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  metricCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    alignItems: "center",
    ...theme.shadow.card,
  },
  metricValue: { fontSize: 20, fontWeight: "800", color: theme.colors.text900, textAlign: "center" },
  metricLabel: { fontSize: 12, color: theme.colors.text600, marginTop: 4, textAlign: "center" },
});
