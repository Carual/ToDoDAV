/** Things an import or export could not carry over as they were. */
export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="transfer-warnings">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}
