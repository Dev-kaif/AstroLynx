import { FeatureUnavailable } from "@/components/feature-unavailable"

export default function DataExplorerPage() {
  return (
    <FeatureUnavailable
      title="Data Explorer is not available yet"
      description="Dataset search and downloads are not connected to a verified MOSDAC data service yet. Use chat to ask questions about the indexed MOSDAC documentation."
    />
  )
}
