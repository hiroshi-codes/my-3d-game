import React, { useRef, useEffect, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { KeyboardControls, useKeyboardControls, Grid } from '@react-three/drei'
import { Physics, useBox } from '@react-three/cannon'
import * as THREE from 'three'

// --- 型定義と設定 ---
const CONTROLS = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
} as const;

type ControlKeys = keyof typeof CONTROLS;
const CAMERA_OFFSET = new THREE.Vector3(0, 5, 10);

// ★ 各床の速度を個別に管理するためのMap
const platformsMap = new Map<number, number>();

const Player = React.forwardRef<THREE.Mesh>((_props, forwardedRef) => {
  const initialPosition: [number, number, number] = [0, 5, 0];
  const [ref, api] = useBox(() => ({
    mass: 1,
    position: initialPosition,
    fixedRotation: true,
    linearDamping: 0.1,
    material: { friction: 0 },
  }), forwardedRef)

  const pos = useRef([0, 0, 0])
  const vel = useRef([0, 0, 0])
  const wasJumpPressed = useRef(false)

  useEffect(() => api.position.subscribe((v) => (pos.current = v)), [api])
  useEffect(() => api.velocity.subscribe((v) => (vel.current = v)), [api])

  const [, getKeys] = useKeyboardControls<ControlKeys>();

  useFrame((state) => {
    const keyboard = getKeys(); // キーボードの状態

    // キーボードとスマホボタン、どちらかが押されていれば true
    const forward = keyboard.forward || mobileInput.forward;
    const backward = keyboard.backward || mobileInput.backward;
    const left = keyboard.left || mobileInput.left;
    const right = keyboard.right || mobileInput.right;
    const jump = keyboard.jump || mobileInput.jump;

    const isGrounded = Math.abs(vel.current[1]) < 0.5;

    // 1. リセットロジック
    if (pos.current[1] < -5) {
      api.position.set(...initialPosition);
      api.velocity.set(0, 0, 0);
      return;
    }

    // 移動計算 (以下、この変数を元に計算)
  let dx = (left ? -1 : 0) + (right ? 1 : 0);
  let dz = (forward ? -1 : 0) + (backward ? 1 : 0);
    const moveSpeed = 6

    // ★ 修正ポイント：現在どの床の上にいるか判定
    let extraX = 0;
    if (isGrounded && pos.current[1] > -0.1) {
      // Z座標からインデックスを逆算（App内の配置ルール -10 - i * 6 に基づく）
      const index = Math.round((pos.current[2] + 10) / -6);
      const targetZ = -10 - index * 6;

      // その床の真上にいるかチェック（Z方向の許容範囲2.5）
      if (index >= 0 && Math.abs(pos.current[2] - targetZ) < 2.5) {
        extraX = platformsMap.get(index) || 0;
      }
    }

    const length = Math.sqrt(dx * dx + dz * dz)
    const directionX = length > 0 ? (dx / length) * moveSpeed : 0;
    const directionZ = length > 0 ? (dz / length) * moveSpeed : 0;

    api.velocity.set(directionX + extraX, vel.current[1], directionZ)

    // 3. ジャンプ
    if (jump && !wasJumpPressed.current && isGrounded) {
      api.velocity.set(vel.current[0], 9, vel.current[2])
    }
    wasJumpPressed.current = jump

    // 4. カメラ追従
    const targetCameraPos = new THREE.Vector3(
      pos.current[0] + CAMERA_OFFSET.x,
      pos.current[1] + CAMERA_OFFSET.y,
      pos.current[2] + CAMERA_OFFSET.z
    )
    state.camera.position.lerp(targetCameraPos, 0.1)
    state.camera.lookAt(pos.current[0], pos.current[1], pos.current[2])
  })

  return (
    <mesh ref={ref as any} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="royalblue" />
    </mesh>
  )
})

function FollowGrid({ playerRef }: { playerRef: React.RefObject<THREE.Object3D> }) {
  const gridRef = useRef<any>(null!)

  useFrame(() => {
    if (!playerRef.current || !gridRef.current) return
    // プレイヤーの足元（y=0付近）にGridを常に固定
    gridRef.current.position.set(
      playerRef.current.position.x,
      0,
      playerRef.current.position.z
    )
  })

  return (
    <Grid
      ref={gridRef}
      infiniteGrid
      sectionSize={5}      // 太い線の間隔（少し広げると見やすいです）
      sectionColor="#444"
      cellSize={1}        // 細かい線の間隔
      cellColor="#222"
      fadeDistance={150}   // ★ここを大きくする（150ユニット先まで描画）
      fadeStrength={1}     // フェードの強さ
    />
  )
}

function Obstacle({ position, args = [1, 1, 1], color = "orange" }: any) {
  const [ref] = useBox(() => ({ type: 'Static', position, args }))
  return (
    <mesh ref={ref as any} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} />
    </mesh>
  )
}

// ★ 修正ポイント：indexを受け取って個別に速度をMapに書き込む
function MovingPlatform({ index, position, args = [3, 0.5, 3], offset = 0, range = 5, speed = 2 }: any) {
  const [ref, api] = useBox(() => ({ type: 'Kinematic', position, args }));

  useFrame((state) => {
    const t = state.clock.getElapsedTime() + offset;
    const x = position[0] + Math.sin(t * speed) * range;
    const vx = Math.cos(t * speed) * speed * range;

    // Mapに自分の現在の速度を保存
    platformsMap.set(index, vx);

    api.position.set(x, position[1], position[2]);
    api.velocity.set(vx, 0, 0);
  });

  return (
    <mesh ref={ref as any} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color="lightgreen" />
    </mesh>
  );
}

function Goal({ position, onGoal }: { position: [number, number, number], onGoal: () => void }) {
  const [ref] = useBox(() => ({
    type: 'Static',
    position,
    args: [5, 0.5, 5],
    onCollide: () => onGoal()
  }))
  return (
    <mesh ref={ref as any}>
      <boxGeometry args={[5, 0.5, 5]} />
      <meshStandardMaterial color="crimson" emissive="crimson" emissiveIntensity={2} />
    </mesh>
  )
}

function FollowLight({ playerRef }: { playerRef: React.RefObject<THREE.Object3D> }) {
  const lightRef = useRef<THREE.DirectionalLight>(null!)
  const [target] = useState(() => new THREE.Object3D()) // 確実に1つのインスタンスを保持

  useFrame(() => {
    if (!playerRef.current || !lightRef.current) return

    const { x, y, z } = playerRef.current.position

    // 1. ライト本体をプレイヤーの斜め上に移動
    lightRef.current.position.set(x + 10, y + 20, z + 10)

    // 2. ターゲットをプレイヤーの足元に移動
    target.position.set(x, y, z)

    // 3. ライトにターゲットを再認識させる
    lightRef.current.target = target
    target.updateMatrixWorld()
  })

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        castShadow
        intensity={1.5}
        shadow-mapSize={[2048, 2048]}
        // 描画範囲を少し広めに設定して、はみ出しを防ぐ
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={0.1}
        shadow-camera-far={100}
      />
    </>
  )
}

// 外部で管理するスマホ入力の状態
const mobileInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

function MobileControls() {
  const handlePress = (key: keyof typeof mobileInput, pressed: boolean) => {
    mobileInput[key] = pressed;
  }

  // ボタンのサイズを「画面の高さ」か「画面の幅」の小さい方を基準に決める
  const btnSize = 'min(12vw, 12vh, 60px)';

  const btn: React.CSSProperties = {
    width: btnSize,
    height: btnSize,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: '12px',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    touchAction: 'none',
    fontSize: '20px',
    border: '1px solid rgba(255,255,255,0.3)',
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    <div style={{
      position: 'fixed', // absoluteより確実に画面内に固定されます
      bottom: '30px',    // 下からしっかり離す
      left: '0',
      width: '100%',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      padding: '0 30px', // 左右からしっかり離す
      pointerEvents: 'none',
      zIndex: 1000,
      boxSizing: 'border-box'
    }}>
      
      {/* 左側：十字キー */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: `repeat(3, ${btnSize})`, 
        gap: '8px', 
        pointerEvents: 'auto' 
      }}>
        <div />
        <div style={btn} onPointerDown={() => handlePress('forward', true)} onPointerUp={() => handlePress('forward', false)} onPointerLeave={() => handlePress('forward', false)}>↑</div>
        <div />
        <div style={btn} onPointerDown={() => handlePress('left', true)} onPointerUp={() => handlePress('left', false)} onPointerLeave={() => handlePress('left', false)}>←</div>
        <div style={btn} onPointerDown={() => handlePress('backward', true)} onPointerUp={() => handlePress('backward', false)} onPointerLeave={() => handlePress('backward', false)}>↓</div>
        <div style={btn} onPointerDown={() => handlePress('right', true)} onPointerUp={() => handlePress('right', false)} onPointerLeave={() => handlePress('right', false)}>→</div>
      </div>

      {/* 右側：ジャンプボタン */}
      <div style={{ pointerEvents: 'auto' }}>
        <div style={{ 
          ...btn, 
          width: 'min(18vw, 18vh, 80px)', 
          height: 'min(18vw, 18vh, 80px)', 
          borderRadius: '50%', 
          backgroundColor: 'rgba(255,255,255,0.3)',
          fontSize: '14px',
          fontWeight: 'bold'
        }} 
        onPointerDown={() => handlePress('jump', true)} 
        onPointerUp={() => handlePress('jump', false)}>
          JUMP
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const playerRef = useRef<THREE.Mesh>(null!)
  const [isCleared, setIsCleared] = useState(false);

  const map = [
    { name: CONTROLS.forward, keys: ['ArrowUp', 'KeyW'] },
    { name: CONTROLS.backward, keys: ['ArrowDown', 'KeyS'] },
    { name: CONTROLS.left, keys: ['ArrowLeft', 'KeyA'] },
    { name: CONTROLS.right, keys: ['ArrowRight', 'KeyD'] },
    { name: CONTROLS.jump, keys: ['Space'] },
  ];

  const platforms = useMemo(() => {
    const data = [];
    for (let i = 0; i < 10; i++) {
      data.push({
        position: [(Math.random() - 0.5) * 8, 0, -10 - i * 6] as [number, number, number],
        offset: Math.random() * Math.PI * 2,
        range: 2 + Math.random() * 3,
        speed: 1 + Math.random() * 1.5
      });
    }
    return data;
  }, []);

  return (
    <KeyboardControls map={map}>
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', touchAction: 'none' }}>
        {isCleared && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: '40px', borderRadius: '20px',
            textAlign: 'center', zIndex: 100
          }}>
            <h1 style={{ fontSize: '3rem', margin: 0 }}>GOAL!!</h1>
            <button onClick={() => window.location.reload()} style={{ marginTop: '20px', padding: '10px 20px', cursor: 'pointer' }}>RETRY</button>
          </div>
        )}
        <MobileControls />
        <Canvas shadows camera={{ fov: 50, near: 0.1, far: 1000 }}>
          <color attach="background" args={['#111']} />
          <ambientLight intensity={0.5} />
          <FollowLight playerRef={playerRef} />
          <FollowGrid playerRef={playerRef} />

          <Physics gravity={[0, -9.81, 0]} defaultContactMaterial={{ friction: 0 }}>
            <Obstacle position={[0, 0, 0]} args={[5, 0.5, 5]} color="#444" />

            {platforms.map((p, index) => (
              <MovingPlatform
                key={index}
                index={index} // ★ インデックスを渡す
                position={p.position}
                offset={p.offset}
                range={p.range}
                speed={p.speed}
              />
            ))}

            <Goal position={[0, 0, -10 - platforms.length * 6 - 5]} onGoal={() => setIsCleared(true)} />
            <Player ref={playerRef} />
          </Physics>
        </Canvas>
      </div>
    </KeyboardControls>
  )
}