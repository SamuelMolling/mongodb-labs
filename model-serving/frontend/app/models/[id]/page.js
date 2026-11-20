import { ModelConsole } from "../../../components/ModelConsole";

export default function Page({ params }) {
  return <ModelConsole modelId={params.id} />;
}
