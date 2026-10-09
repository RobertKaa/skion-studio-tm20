import { REST_VEHICLE_POSE, poseIsActive, type VehiclePose } from '../three/vehiclePose';
import './vehiclePose.css';

export function VehiclePoseControls({ value, onChange }: { value: VehiclePose; onChange: (value: VehiclePose) => void }) {
  const active = poseIsActive(value);
  return <details className="vehicle-pose-controls">
    <summary>Simuler les roues et réacteurs <span>{active ? 'Aperçu actif' : 'Pose du modèle'}</span></summary>
    <div className="vehicle-pose-body">
      <div className="vehicle-pose-fields">
        <label>Braquage <input aria-label="Braquage de test" type="range" min="-35" max="35" value={value.steering} onChange={(e) => onChange({ ...value, steering: Number(e.target.value) })} /><output>{value.steering}°</output></label>
        <label>Rotation des roues <input aria-label="Rotation des roues de test" type="range" min="-180" max="180" value={value.spin} onChange={(e) => onChange({ ...value, spin: Number(e.target.value) })} /><output>{value.spin}°</output></label>
        <label>Propulseurs <select aria-label="Propulseurs de test" value={value.reactor} onChange={(e) => onChange({ ...value, reactor: e.target.value as VehiclePose['reactor'] })}>
          <option value="off">Désactivés</option><option value="up">Up · poussée vers le haut</option><option value="down">Down · poussée vers le bas</option>
        </select></label>
        <button type="button" className="btn" disabled={!active} onClick={() => onChange({ ...REST_VEHICLE_POSE })}>Revenir à l’édition</button>
      </div>
      <p role="status">{active ? 'La peinture 3D est suspendue. Les flèches indiquent la direction simulée des jets.' : 'Observez si les pneus, jantes et moyeux restent solidaires.'} Cette pose est calculée par le studio. Elle ne valide pas les animations ni les particules dans Trackmania.</p>
    </div>
  </details>;
}
