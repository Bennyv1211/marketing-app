import React, { createContext, useContext, useState } from "react";

export type UploadedImage = { id: string; data_uri: string; mime_type: string };
export type GeneratedImage = { id: string; variation_index: number; style_name: string; data_uri: string };
export type GeneratedCaption = {
  id: string;
  style: string;
  caption: string;
  hashtags: string[];
  cta: string;
};

type WizardState = {
  upload: UploadedImage | null;
  prompt: string;
  tone: string;
  postGoal: string;
  generatedImages: GeneratedImage[];
  selectedImage: GeneratedImage | null;
  generatedCaptions: GeneratedCaption[];
  selectedCaption: GeneratedCaption | null;
  instagramEnabled: boolean;
  facebookEnabled: boolean;
};

const initial: WizardState = {
  upload: null,
  prompt: "",
  tone: "friendly",
  postGoal: "general brand post",
  generatedImages: [],
  selectedImage: null,
  generatedCaptions: [],
  selectedCaption: null,
  instagramEnabled: true,
  facebookEnabled: false,
};

type WizardCtx = WizardState & {
  set: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  reset: () => void;
};

const WizardContext = createContext<WizardCtx | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WizardState>(initial);
  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((s) => ({ ...s, [key]: value }));
  const reset = () => setState(initial);
  return (
    <WizardContext.Provider value={{ ...state, set, reset }}>{children}</WizardContext.Provider>
  );
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used inside WizardProvider");
  return ctx;
}
