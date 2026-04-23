import React, { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../components/Button";
import { theme } from "../lib/theme";
import { useAuth } from "../lib/AuthContext";

export default function Landing() {
  const router = useRouter();
  const { user, business, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) {
      if (!business) router.replace("/onboarding");
      else router.replace("/dashboard");
    }
  }, [user, business, loading, router]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1753351052046-8c6818304a4f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NDh8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwb3duZXIlMjBzbWlsaW5nfGVufDB8fHx8MTc3Njk1MjM2NHww&ixlib=rb-4.1.0&q=85",
            }}
            style={styles.heroImage}
          />
          <View style={styles.heroOverlay} />
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>AutoSocial AI</Text>
          </View>
        </View>

        <View style={styles.content}>
          <Text style={styles.title} testID="landing-title">
            Turn any photo into{"\n"}a ready-to-post ad.
          </Text>
          <Text style={styles.subtitle}>
            Snap a photo of your product. Tell us the vibe. We'll design a beautiful post and caption for you in seconds.
          </Text>

          <View style={styles.featureRow}>
            <Feature icon="camera-outline" label="Upload a photo" />
            <Feature icon="sparkles-outline" label="AI designs it" />
            <Feature icon="share-social-outline" label="Post in one tap" />
          </View>

          <Button
            label="Create your first post"
            onPress={() => router.push("/register")}
            testID="landing-create-first-post"
          />
          <View style={{ height: 12 }} />
          <Button
            label="I already have an account"
            variant="secondary"
            onPress={() => router.push("/login")}
            testID="landing-sign-in"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Feature({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={22} color={theme.colors.primary} />
      </View>
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { flexGrow: 1 },
  hero: { height: 280, position: "relative" },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(28,28,28,0.25)",
  },
  heroBadge: {
    position: "absolute",
    top: 20,
    left: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  heroBadgeText: { fontWeight: "800", color: theme.colors.primary, fontSize: 13, letterSpacing: 0.5 },
  content: { padding: 24, paddingTop: 28 },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: theme.colors.text900,
    lineHeight: 38,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.text600,
    lineHeight: 24,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
    gap: 12,
  },
  feature: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    alignItems: "center",
    ...theme.shadow.card,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  featureLabel: { fontSize: 12, fontWeight: "600", color: theme.colors.text800, textAlign: "center" },
});
