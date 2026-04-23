import React from "react";
import { Text, TouchableOpacity, StyleSheet, ActivityIndicator, ViewStyle, StyleProp } from "react-native";
import { theme } from "../lib/theme";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export default function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  testID,
  style,
}: Props) {
  const isSecondary = variant === "secondary";
  const isDanger = variant === "danger";
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        styles.base,
        isSecondary && styles.secondary,
        isDanger && styles.danger,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? theme.colors.primary : "#fff"} />
      ) : (
        <Text
          style={[
            styles.label,
            isSecondary && { color: theme.colors.text800 },
            isDanger && { color: "#fff" },
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    ...theme.shadow.card,
  },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.borderStrong,
    shadowOpacity: 0,
    elevation: 0,
  },
  danger: { backgroundColor: theme.colors.danger },
  disabled: { opacity: 0.5 },
  label: {
    color: "#fff",
    fontSize: theme.font.button,
    fontWeight: "700",
  },
});
