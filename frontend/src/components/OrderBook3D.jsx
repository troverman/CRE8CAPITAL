import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function DepthSurface({ snapshots, levels, timeSteps }) {
  const meshRef = useRef(null);
  const rows = levels * 2;

  const geometry = useMemo(() => {
    const vertices = [];
    const colors = [];
    const indices = [];
    const safeRows = Math.max(rows, 2);
    const safeTimeSteps = Math.max(timeSteps, 2);

    for (let t = 0; t < safeTimeSteps; t += 1) {
      for (let p = 0; p < safeRows; p += 1) {
        const x = (t / (safeTimeSteps - 1) - 0.5) * 10;
        const z = (p / (safeRows - 1) - 0.5) * 5.4;
        vertices.push(x, 0, z);

        const isBid = p < levels;
        const depthRatio = isBid ? p / Math.max(levels, 1) : (p - levels) / Math.max(levels, 1);
        colors.push(
          isBid ? 0.14 : 0.45 + depthRatio * 0.38,
          isBid ? 0.42 + depthRatio * 0.4 : 0.08,
          isBid ? 0.28 + depthRatio * 0.24 : 0.08
        );
      }
    }

    for (let t = 0; t < safeTimeSteps - 1; t += 1) {
      for (let p = 0; p < safeRows - 1; p += 1) {
        const a = t * safeRows + p;
        const b = a + 1;
        const c = a + safeRows;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    surfaceGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    surfaceGeometry.setIndex(indices);
    surfaceGeometry.computeVertexNormals();
    return surfaceGeometry;
  }, [levels, rows, timeSteps]);

  useEffect(() => {
    if (!meshRef.current) return;
    const windowed = snapshots.slice(-timeSteps);
    const safeRows = Math.max(rows, 2);
    const safeTimeSteps = Math.max(timeSteps, 2);

    let maxSize = 1;
    for (const snapshot of windowed) {
      for (const level of [...(snapshot?.bids || []), ...(snapshot?.asks || [])]) {
        maxSize = Math.max(maxSize, Number(level?.size) || 0);
      }
    }

    const positionAttr = meshRef.current.geometry.attributes.position;
    const positions = positionAttr.array;
    for (let t = 0; t < safeTimeSteps; t += 1) {
      const snapshotIndex = t - (safeTimeSteps - windowed.length);
      const snapshot = snapshotIndex >= 0 ? windowed[snapshotIndex] : null;
      const bids = snapshot ? [...(snapshot.bids || [])].sort((a, b) => b.price - a.price).slice(0, levels) : [];
      const asks = snapshot ? [...(snapshot.asks || [])].sort((a, b) => a.price - b.price).slice(0, levels) : [];

      for (let p = 0; p < safeRows; p += 1) {
        const isBid = p < levels;
        const level = isBid ? bids[p] : asks[p - levels];
        const size = Number(level?.size) || 0;
        positions[(t * safeRows + p) * 3 + 1] = (size / maxSize) * 3.2;
      }
    }

    positionAttr.needsUpdate = true;
    meshRef.current.geometry.computeVertexNormals();
  }, [levels, rows, snapshots, timeSteps]);

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.5} metalness={0.15} />
    </mesh>
  );
}

function OrderBook3DScene({ snapshots, levels, timeSteps }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 6.5, 10);
    camera.lookAt(0, 0.4, 0);
  }, [camera]);

  return (
    <>
      <ambientLight intensity={0.52} />
      <directionalLight position={[3, 6, 4]} intensity={0.68} />
      <DepthSurface snapshots={snapshots} levels={levels} timeSteps={timeSteps} />
      <gridHelper args={[12, 12, '#1f2a4d', '#141c35']} position={[0, -0.02, 0]} />
      <OrbitControls enablePan={false} minDistance={4} maxDistance={24} />
    </>
  );
}

export default function OrderBook3D({ snapshots = [], levels = 10, timeSteps = 32 }) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return <p className="depth-3d-empty">Collecting order book snapshots...</p>;
  }

  return (
    <div className="depth-3d-canvas">
      <Canvas camera={{ fov: 42 }} gl={{ alpha: true }} dpr={[1, 1.5]}>
        <OrderBook3DScene snapshots={snapshots} levels={levels} timeSteps={timeSteps} />
      </Canvas>
    </div>
  );
}
