import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Share,
  Alert,
  Linking,
  Platform,
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

  const manualUploadText = useMemo(() => {
    if (!post) return "";
    return [
      "AdFlow manual upload kit",
      "",
      "Caption:",
      post.caption_text || "-",
      "",
      "CTA:",
      post.caption_cta || "-",
      "",
      "Hashtags:",
      post.caption_hashtags?.join(" ") || "-",
    ].join("\n");
  }, [post]);

  const openImage = async () => {
    if (!post?.image_data_uri) return;
    try {
      await Linking.openURL(post.image_data_uri);
    } catch {
      Alert.alert("Couldn't open image", "Please try again.");
    }
  };

  const shareManualUpload = async () => {
    if (!post) return;
    try {
      await Share.share({
        message: manualUploadText,
        url: Platform.OS === "ios" ? post.image_data_uri : undefined,
      });
    } catch {
      Alert.alert("Couldn't share", "Please try again.");
    }
  };

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

            <View style={styles.actionsCard}>
              <Text style={styles.title}>Manual upload kit</Text>
              <Text style={styles.subtle}>
                Open the image and copy the caption, CTA, and hashtags if you want to post manually.
              </Text>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={openImage} testID="post-open-image">
                  <Ionicons name="download-outline" size={18} color={theme.colors.primary} />
                  <Text style={styles.actionText}>Open image</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={shareManualUpload} testID="post-share-text">
                  <Ionicons name="share-social-outline" size={18} color={theme.colors.primary} />
                  <Text style={styles.actionText}>Share text</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.title}>Post details</Text>
              <Text style={styles.subtle}>
                {platforms.join(", ") || "No platform selected"}
                {post.publish_status ? ` - ${post.publish_status}` : ""}
              </Text>
              <Text style={styles.promptLabel}>Caption pack</Text>
              <Text selectable style={styles.promptText}>{manualUploadText}</Text>
              <Text style={styles.caption}>{post.caption_text || "(no caption)"}</Text>
              {post.caption_cta ? <Text style={styles.cta}>{post.caption_cta}</Text> : null}
              {post.caption_hashtags?.length ? (
                <Text style={styles.tags}>{post.caption_hashtags.join(" ")}</Text>
              ) : null}
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Image style</Text>
              <Text style={styles.detailValue}>{post.image_style || "-"}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
  actionsCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    ...theme.shadow.card,
  },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  actionBtn: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: theme.colors.borderStrong,
    backgroundColor: "#fff",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionText: { color: theme.colors.text800, fontWeight: "700", fontSize: 14 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 18,
    ...theme.shadow.card,
  },
  title: { fontSize: 22, fontWeight: "800", color: theme.colors.text900 },
  subtle: { fontSize: 13, color: theme.colors.text600, marginTop: 6, marginBottom: 14 },
  promptLabel: { fontSize: 12, fontWeight: "800", color: theme.colors.text800, marginBottom: 6 },
  promptText: {
    fontSize: 14,
    color: theme.colors.text900,
    lineHeight: 21,
    backgroundColor: theme.colors.primaryLight,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  caption: { fontSize: 16, color: theme.colors.text800, lineHeight: 24 },
  cta: { fontSize: 15, color: theme.colors.primary, fontWeight: "800", marginTop: 12 },
  tags: { fontSize: 13, color: theme.colors.secondary, fontWeight: "700", marginTop: 10 },
  detailRow: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.primaryLight,
  },
  detailLabel: { fontSize: 12, color: theme.colors.text600, fontWeight: "800", marginBottom: 6 },
  detailValue: { fontSize: 14, color: theme.colors.text900, fontWeight: "700" },
});
