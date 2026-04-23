import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../lib/theme";

export function StepHeader({
  step,
  total,
  title,
  subtitle,
}: {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
}) {
  const pct = (step / total) * 100;
  return (
    <View style={styles.container}>
      <Text style={styles.stepLabel} testID={`step-label-${step}`}>
        Step {step} of {total}
      </Text>
      <View style={styles.barWrap}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.title} testID="step-title">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 20 },
  stepLabel: {
    fontSize: 13,
    color: theme.colors.text600,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  barWrap: {
    height: 8,
    width: "100%",
    backgroundColor: theme.colors.border,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 16,
  },
  barFill: { height: "100%", backgroundColor: theme.colors.primary, borderRadius: 999 },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: theme.colors.text900,
    marginBottom: 6,
  },
  subtitle: { fontSize: 15, color: theme.colors.text600, lineHeight: 22 },
});
