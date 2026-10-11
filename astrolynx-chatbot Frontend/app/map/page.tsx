import { FeatureUnavailable } from "@/components/feature-unavailable"

export default function MapPage() {
  return (
    <FeatureUnavailable
      title="Map view is not available yet"
      description="AstroLynx does not have a verified live satellite map or map data service connected yet. Use chat to ask questions about the indexed MOSDAC documentation."
    />
  )
}
