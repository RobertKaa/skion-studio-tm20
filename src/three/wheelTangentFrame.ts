import * as THREE from 'three';

/**
 * Physical tyre normals use an orthonormal tangent frame. Three's derivative
 * fallback retains the atlas's unequal U/V metric and attenuates one component
 * on a narrow tyre strip. Explicit unit tangents remove that UV-dependent scale.
 * Position, normal, UV and index buffers remain the original editable geometry.
 */
export function ensureWheelTangentFrame(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || !Number.isInteger(position.count) || position.count > 2_000_000) return;
  const normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  const count = position.count, index = geometry.getIndex();
  const tangentSum = new Float64Array(count * 3), bitangentSum = new Float64Array(count * 3);
  const tangent = new Float32Array(count * 4);
  const p = new THREE.Vector3(), edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3();
  const u = new THREE.Vector2(), du1 = new THREE.Vector2(), du2 = new THREE.Vector2();
  const t = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  const finite = (vector: THREE.Vector3) => Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
  if (uv && uv.itemSize >= 2 && uv.count >= count) {
    const corners = index ? index.count : count;
    for (let face = 0; face + 2 < corners; face += 3) {
      const a = index ? index.getX(face) : face;
      const c = index ? index.getX(face + 1) : face + 1;
      const d = index ? index.getX(face + 2) : face + 2;
      if (![a, c, d].every(vertex => Number.isInteger(vertex) && vertex >= 0 && vertex < count)) continue;
      p.fromBufferAttribute(position, a);
      edge1.fromBufferAttribute(position, c).sub(p); edge2.fromBufferAttribute(position, d).sub(p);
      u.set(uv.getX(a), uv.getY(a));
      du1.set(uv.getX(c), uv.getY(c)).sub(u); du2.set(uv.getX(d), uv.getY(d)).sub(u);
      const determinant = du1.x * du2.y - du1.y * du2.x;
      if (!finite(edge1) || !finite(edge2) || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) continue;
      t.copy(edge1).multiplyScalar(du2.y).addScaledVector(edge2, -du1.y).multiplyScalar(1 / determinant);
      b.copy(edge2).multiplyScalar(du1.x).addScaledVector(edge1, -du2.x).multiplyScalar(1 / determinant);
      if (!finite(t) || !finite(b)) continue;
      for (const vertex of [a, c, d]) {
        const offset = vertex * 3;
        tangentSum[offset] += t.x; tangentSum[offset + 1] += t.y; tangentSum[offset + 2] += t.z;
        bitangentSum[offset] += b.x; bitangentSum[offset + 1] += b.y; bitangentSum[offset + 2] += b.z;
      }
    }
  }
  for (let vertex = 0; vertex < count; vertex++) {
    if (normal && normal.itemSize >= 3 && normal.count > vertex) n.fromBufferAttribute(normal, vertex);
    else n.set(0, 0, 1);
    if (!finite(n) || n.lengthSq() < 1e-20) n.set(0, 0, 1);
    else n.normalize();
    const offset = vertex * 3;
    t.set(tangentSum[offset], tangentSum[offset + 1], tangentSum[offset + 2]);
    t.addScaledVector(n, -n.dot(t));
    if (!finite(t) || t.lengthSq() < 1e-20) {
      // A missing/degenerate UV island still receives a finite perpendicular frame.
      if (Math.abs(n.z) < .9) t.set(0, 0, 1);
      else t.set(0, 1, 0);
      t.cross(n);
    }
    t.normalize();
    b.set(bitangentSum[offset], bitangentSum[offset + 1], bitangentSum[offset + 2]);
    const handedness = p.crossVectors(n, t).dot(b) < 0 ? -1 : 1;
    tangent[vertex * 4] = t.x; tangent[vertex * 4 + 1] = t.y; tangent[vertex * 4 + 2] = t.z; tangent[vertex * 4 + 3] = handedness;
  }
  geometry.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
}
