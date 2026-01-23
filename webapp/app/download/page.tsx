"use client";

import Image from "next/image";
import { Download, Apple, Monitor, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

const GITHUB_RELEASE_URL =
  "https://api.github.com/repos/andy-t-wang/world-chat-desktop/releases/latest";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

type Platform = "mac-arm64" | "mac-x64" | "windows" | "linux" | "unknown";

interface DownloadOption {
  platform: Platform;
  label: string;
  sublabel: string;
  icon: "apple" | "windows" | "linux";
  asset: ReleaseAsset | null;
  requirements: string;
}

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "unknown";

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() || "";

  // Check for macOS
  if (platform.includes("mac") || userAgent.includes("mac")) {
    // Check for Apple Silicon using various methods
    // Modern browsers expose this, older ones default to Intel
    const isAppleSilicon =
      // Check WebGL renderer for Apple GPU
      (() => {
        try {
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl");
          if (gl) {
            const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
            if (debugInfo) {
              const renderer = gl.getParameter(
                debugInfo.UNMASKED_RENDERER_WEBGL,
              );
              return renderer.includes("Apple M");
            }
          }
        } catch {
          // Ignore
        }
        return false;
      })();

    return isAppleSilicon ? "mac-arm64" : "mac-x64";
  }

  // Check for Windows
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "windows";
  }

  // Check for Linux
  if (platform.includes("linux") || userAgent.includes("linux")) {
    return "linux";
  }

  return "unknown";
}

function getAssetForPlatform(
  assets: ReleaseAsset[],
  platform: Platform,
): ReleaseAsset | null {
  switch (platform) {
    case "mac-arm64":
      return (
        assets.find(
          (a) => a.name.includes("arm64") && a.name.endsWith(".dmg"),
        ) || null
      );
    case "mac-x64":
      return (
        assets.find((a) => a.name.includes("x64") && a.name.endsWith(".dmg")) ||
        null
      );
    case "windows":
      return assets.find((a) => a.name.endsWith(".exe")) || null;
    case "linux":
      return assets.find((a) => a.name.endsWith(".AppImage")) || null;
    default:
      return null;
  }
}

function PlatformIcon({
  type,
  className,
}: {
  type: "apple" | "windows" | "linux";
  className?: string;
}) {
  if (type === "apple") {
    return <Apple className={className} />;
  }
  if (type === "windows") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    );
  }
  // Linux (Tux-inspired simple icon)
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.002c-.06-.135-.12-.2-.18-.264-.12-.135-.238-.334-.357-.465-.07-.066-.13-.2-.202-.266-.29.535-.07.869.109 1.338.085.2.196.402.169.671a.927.927 0 01-.142.398c-.04.135-.102.135-.142.135l-.024-.006c-.092-.003-.18-.135-.264-.268-.089-.133-.166-.333-.24-.465h-.006c-.057-.065-.092-.2-.197-.265-.024-.011-.048-.021-.074-.032l-.03-.015c-.006-.004-.013-.006-.02-.01a3.562 3.562 0 01-.497-.4c-.109-.134-.202-.333-.258-.533a1.62 1.62 0 00-.062-.2v-.003a1.127 1.127 0 01-.062-.328c-.009-.333.053-.603.062-.736.009-.135-.009-.2-.052-.27-.053-.066-.167-.066-.282-.066h-.006c-.246 0-.27.066-.463.2-.089.066-.155.133-.192.133h-.02c-.023-.003-.042-.02-.06-.066-.12-.2-.048-.47.038-.733.058-.2.137-.402.15-.603v-.003c.009-.135.009-.332-.031-.465-.04-.135-.121-.2-.2-.266-.158-.135-.307-.2-.439-.333-.13-.135-.243-.333-.307-.535a2.1 2.1 0 01-.102-.4c-.04-.2-.09-.336-.156-.465-.067-.135-.149-.2-.24-.334-.119-.133-.205-.333-.246-.533v-.003a2.515 2.515 0 01-.035-.533 1.44 1.44 0 01.05-.4h-.006c.013-.067.025-.134.036-.198.034-.135.088-.266.138-.4.106-.332.256-.666.372-.999.228-.667.456-1.333.456-2.133 0-.2-.012-.4-.04-.603.109.135.228.267.352.4h.003c.102.133.201.333.262.533.032.135.06.268.07.4.009.2.009.4-.032.603-.04.2-.086.4-.152.603-.035.066-.067.132-.1.2z" />
    </svg>
  );
}

function DownloadButton({
  option,
  primary = false,
}: {
  option: DownloadOption;
  primary?: boolean;
}) {
  if (!option.asset) {
    return null;
  }

  return (
    <a
      href={option.asset.browser_download_url}
      className={`flex items-center gap-3 px-5 py-3 rounded-xl transition-colors w-full ${
        primary
          ? "bg-[#1D1D1F] text-white hover:bg-[#333]"
          : "bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]"
      }`}
    >
      <PlatformIcon
        type={option.icon}
        className={`w-5 h-5 ${primary ? "" : "opacity-80"}`}
      />
      <div className="flex flex-col items-start flex-1">
        <span className="text-[15px] font-medium">{option.label}</span>
        <span
          className={`text-[12px] ${
            primary ? "text-white/60" : "text-[#86868B]"
          }`}
        >
          {formatSize(option.asset.size)} · {option.sublabel}
        </span>
      </div>
      <Download className={`w-4 h-4 ${primary ? "" : "opacity-60"}`} />
    </a>
  );
}

export default function DownloadPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>("unknown");
  const [showAllDownloads, setShowAllDownloads] = useState(false);

  useEffect(() => {
    // Detect platform
    setDetectedPlatform(detectPlatform());

    // Fetch release info
    fetch(GITHUB_RELEASE_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setRelease(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const version = release?.tag_name?.replace("v", "") || "";
  const assets = release?.assets || [];

  // Build download options
  const downloadOptions: DownloadOption[] = [
    {
      platform: "mac-arm64",
      label: "Download for Mac",
      sublabel: "Apple Silicon (M-series)",
      icon: "apple",
      asset: getAssetForPlatform(assets, "mac-arm64"),
      requirements: "Requires macOS 11 Big Sur or later",
    },
    {
      platform: "mac-x64",
      label: "Download for Mac",
      sublabel: "Intel",
      icon: "apple",
      asset: getAssetForPlatform(assets, "mac-x64"),
      requirements: "Requires macOS 11 Big Sur or later",
    },
    {
      platform: "windows",
      label: "Download for Windows",
      sublabel: "Windows 10/11 (64-bit)",
      icon: "windows",
      asset: getAssetForPlatform(assets, "windows"),
      requirements: "Requires Windows 10 or later",
    },
    {
      platform: "linux",
      label: "Download for Linux",
      sublabel: "AppImage (64-bit)",
      icon: "linux",
      asset: getAssetForPlatform(assets, "linux"),
      requirements: "Most Linux distributions",
    },
  ];

  // Get the recommended download based on detected platform
  const recommendedOption =
    downloadOptions.find((o) => o.platform === detectedPlatform) ||
    downloadOptions[0];

  // Other download options
  const otherOptions = downloadOptions.filter(
    (o) => o.platform !== recommendedOption.platform && o.asset,
  );

  // Get title based on detected platform
  const getTitle = () => {
    switch (detectedPlatform) {
      case "mac-arm64":
      case "mac-x64":
        return "World Chat for Mac";
      case "windows":
        return "World Chat for Windows";
      case "linux":
        return "World Chat for Linux";
      default:
        return "World Chat Desktop";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <div className="w-8 h-8 border-2 border-[#1D1D1F] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* App icon */}
        <Image
          src="/app-icon.png"
          alt="World Chat"
          width={80}
          height={80}
          className="mb-6"
        />

        {/* Title */}
        <h1 className="text-[28px] font-semibold text-[#1D1D1F] tracking-[-0.02em] mb-2">
          {getTitle()}
        </h1>

        {/* Version */}
        {version && (
          <p className="text-[15px] text-[#86868B] mb-8">Version {version}</p>
        )}

        {/* Primary download button */}
        {recommendedOption.asset ? (
          <div className="w-full space-y-3">
            <DownloadButton option={recommendedOption} primary />

            {/* Requirements for primary */}
            <p className="text-[13px] text-[#86868B] text-center">
              {recommendedOption.requirements}
            </p>

            {/* Other downloads toggle */}
            {otherOptions.length > 0 && (
              <div className="pt-4">
                <button
                  onClick={() => setShowAllDownloads(!showAllDownloads)}
                  className="flex items-center justify-center gap-2 w-full text-[14px] text-[#0066CC] hover:text-[#004499] transition-colors"
                >
                  <span>Other platforms</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      showAllDownloads ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/* Other download options */}
                {showAllDownloads && (
                  <div className="mt-4 space-y-2">
                    {otherOptions.map((option) => (
                      <DownloadButton key={option.platform} option={option} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[15px] text-[#86868B]">
            Download temporarily unavailable. Try again later.
          </p>
        )}

        {/* Footer note */}
        <div className="mt-12 text-center">
          <p className="text-[13px] text-[#86868B]">
            End-to-end encrypted messaging
          </p>
        </div>
      </div>
    </div>
  );
}
