import type { ReactNode } from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const MARGIN = 72;
const BODY_PT = 14;

// Strip characters that commonly break @react-pdf/fontkit and normalize to
// Helvetica-safe ASCII so the existing Jump to Action PDF layout stays stable.
export function sanitizeStrategyTextForPdf(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFKD")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[•●◯◦▪]/g, "*")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[\u200D\u200C]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

const styles = StyleSheet.create({
  page: {
    padding: MARGIN,
    fontFamily: "Helvetica",
    fontSize: BODY_PT,
    lineHeight: 1.5,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Helvetica",
    marginBottom: 14,
    color: "#374151",
  },
  sectionHead: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 10,
    marginBottom: 4,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.45,
    marginBottom: 3,
  },
  bullet: {
    flexDirection: "row",
    marginLeft: 12,
    marginBottom: 3,
  },
  bulletMark: { width: 12, fontSize: 11 },
  bulletText: { flex: 1, fontSize: 11, lineHeight: 1.45 },
});

function linesToElements(text: string) {
  const lines = sanitizeStrategyTextForPdf(text).split(/\r?\n/);
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(
        <Text key={`sp-${i}`} style={styles.body}>
          {" "}
        </Text>,
      );
      return;
    }
    const isBullet = /^([*-]|[A-Z][.)]|\d+[.)])\s+/.test(trimmed);
    if (isBullet) {
      out.push(
        <View key={`b-${i}`} style={styles.bullet} wrap={false}>
          <Text style={styles.bulletMark}>-</Text>
          <Text style={styles.bulletText}>{trimmed.replace(/^([*-])\s*/, "")}</Text>
        </View>,
      );
    } else {
      out.push(
        <Text key={`p-${i}`} style={styles.body}>
          {trimmed}
        </Text>,
      );
    }
  });
  return out;
}

export function StrategyPdfDocument(props: {
  businessName: string;
  /** Strategy sections only; meta is omitted for a tight action export. */
  sections: Array<{ label: string; body: string }>;
}) {
  const biz = sanitizeStrategyTextForPdf(props.businessName);
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <Text style={styles.title}>Jump to Action</Text>
        <Text style={styles.subtitle}>{biz}</Text>
        {props.sections.map((s) => (
          <View key={s.label} wrap>
            <Text style={styles.sectionHead}>{sanitizeStrategyTextForPdf(s.label)}</Text>
            {linesToElements(s.body || "-")}
          </View>
        ))}
      </Page>
    </Document>
  );
}
