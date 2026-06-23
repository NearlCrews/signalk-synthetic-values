import type React from 'react';

interface Props {
  configuration: Record<string, unknown>;
  save: (config: Record<string, unknown>) => void;
}

const PluginConfigurationPanel: React.FC<Props> = () => {
  return <div className="skn-panel">Synthetic Values configuration</div>;
};

export default PluginConfigurationPanel;
