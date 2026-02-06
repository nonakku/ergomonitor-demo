// DOM要素参照：描画やボタン操作で頻繁に使うため先に取得
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const loading = document.getElementById('loading');

// UI要素参照：数値・ゲージ表示を更新する対象
const scoreEl = document.getElementById('score');
const loadLevelEl = document.getElementById('load-level');
const loadBarEl = document.getElementById('load-bar');
const trunkAngleEl = document.getElementById('trunk-angle');
const kneeAngleEl = document.getElementById('knee-angle');

let pose;
let camera;
let isCameraRunning = false;

// 3点の角度（関節角）を算出するユーティリティ
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
}

// 体幹の傾き角度（鉛直方向を基準）を算出
function calculateTrunkAngle(shoulder, hip) {
    const dx = hip.x - shoulder.x;
    const dy = hip.y - shoulder.y;
    const angle = Math.atan2(dx, dy) * 180 / Math.PI;
    return Math.abs(angle);
}

// RULAの考え方を参考にした簡易計算（現場向けの目安）
// 体幹の前傾が大きいほど負荷が高いという前提
// 膝を深く曲げてしゃがむほど負荷が軽減されるという前提
// 0〜100の相対スコアに正規化して可視化に使う
function estimateLoadLevel(trunkAngle, kneeAngle) {
    let loadScore = 0;

    // 体幹角度の寄与（0〜60度の範囲想定）
    // 閾値は「傾きが大きいほど危険」の段階評価として設定
    if (trunkAngle < 15) {
        loadScore += 0;
    } else if (trunkAngle < 30) {
        loadScore += 30;
    } else if (trunkAngle < 45) {
        loadScore += 60;
    } else {
        loadScore += 100;
    }

    // 膝角度の補正（深く曲げるほど負荷を軽減）
    // しゃがみ動作を促すため、膝が曲がるほど加点を減らす
    if (kneeAngle < 120) {
        loadScore -= 20; // 良いスクワット姿勢
    } else if (kneeAngle < 150) {
        loadScore -= 10;
    }

    return Math.max(0, Math.min(100, loadScore));
}

// 閾値に応じた表示クラス（good / warning / danger）を返す
function getStatusClass(value, thresholds) {
    if (value < thresholds[0]) return 'good';
    if (value < thresholds[1]) return 'warning';
    return 'danger';
}

// 推定結果をUIに反映（数値・ゲージ・色）
function updateUI(landmarks) {
    if (!landmarks || landmarks.length < 33) return;

    // MediaPipe Poseのランドマーク番号
    const LEFT_SHOULDER = 11;
    const RIGHT_SHOULDER = 12;
    const LEFT_HIP = 23;
    const RIGHT_HIP = 24;
    const LEFT_KNEE = 25;
    const RIGHT_KNEE = 26;
    const LEFT_ANKLE = 27;
    const RIGHT_ANKLE = 28;

    // 中点（左右の平均）を計算
    const shoulder = {
        x: (landmarks[LEFT_SHOULDER].x + landmarks[RIGHT_SHOULDER].x) / 2,
        y: (landmarks[LEFT_SHOULDER].y + landmarks[RIGHT_SHOULDER].y) / 2
    };
    const hip = {
        x: (landmarks[LEFT_HIP].x + landmarks[RIGHT_HIP].x) / 2,
        y: (landmarks[LEFT_HIP].y + landmarks[RIGHT_HIP].y) / 2
    };

    // 体幹角度を計算
    const trunkAngle = calculateTrunkAngle(shoulder, hip);

    // 膝角度を計算（左膝を基準）
    const kneeAngle = calculateAngle(
        landmarks[LEFT_HIP],
        landmarks[LEFT_KNEE],
        landmarks[LEFT_ANKLE]
    );

    // 負荷レベルを計算
    const loadLevel = estimateLoadLevel(trunkAngle, kneeAngle);

    // 総合スコア（負荷の逆数）を計算
    // 数値が高いほど「姿勢が良い」ことを直感的に示すため
    const score = Math.round(100 - loadLevel);

    // UIを更新
    const trunkStatus = getStatusClass(trunkAngle, [20, 40]);
    const loadStatus = getStatusClass(loadLevel, [30, 60]);

    scoreEl.textContent = score;
    scoreEl.className = `score-value status-${loadStatus}`;

    loadLevelEl.textContent = loadLevel < 30 ? '良い' : loadLevel < 60 ? '注意' : '危険';
    loadLevelEl.className = `metric-value status-${loadStatus}`;
    loadBarEl.style.width = `${loadLevel}%`;
    loadBarEl.className = `metric-bar-fill bg-${loadStatus}`;

    trunkAngleEl.textContent = `${Math.round(trunkAngle)}°`;
    trunkAngleEl.className = `metric-value status-${trunkStatus}`;

    kneeAngleEl.textContent = `${Math.round(kneeAngle)}°`;
}

// スケルトン描画（関節・線・負荷の色分け）
function drawSkeleton(landmarks) {
    if (!landmarks) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 骨格ラインを描画
    const connections = [
        [11, 12], // 肩
        [11, 13], [13, 15], // 左腕
        [12, 14], [14, 16], // 右腕
        [11, 23], [12, 24], // 胴体
        [23, 24], // 腰
        [23, 25], [25, 27], // 左脚
        [24, 26], [26, 28], // 右脚
    ];

    // 体幹角度に応じた色分け用に負荷を計算
    const LEFT_SHOULDER = 11;
    const RIGHT_SHOULDER = 12;
    const LEFT_HIP = 23;
    const RIGHT_HIP = 24;

    const shoulder = {
        x: (landmarks[LEFT_SHOULDER].x + landmarks[RIGHT_SHOULDER].x) / 2,
        y: (landmarks[LEFT_SHOULDER].y + landmarks[RIGHT_SHOULDER].y) / 2
    };
    const hip = {
        x: (landmarks[LEFT_HIP].x + landmarks[RIGHT_HIP].x) / 2,
        y: (landmarks[LEFT_HIP].y + landmarks[RIGHT_HIP].y) / 2
    };
    const trunkAngle = calculateTrunkAngle(shoulder, hip);

    // 体幹角度に応じた色
    let lineColor = '#4ade80'; // 緑
    if (trunkAngle > 40) {
        lineColor = '#f87171'; // 赤
    } else if (trunkAngle > 20) {
        lineColor = '#facc15'; // 黄
    }

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    connections.forEach(([i, j]) => {
        const p1 = landmarks[i];
        const p2 = landmarks[j];
        if (p1.visibility > 0.5 && p2.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
            ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
            ctx.stroke();
        }
    });

    // 関節点を描画
    ctx.fillStyle = '#fff';
    landmarks.forEach((landmark, i) => {
        if (landmark.visibility > 0.5 && i >= 11 && i <= 28) {
            ctx.beginPath();
            ctx.arc(
                landmark.x * canvas.width,
                landmark.y * canvas.height,
                6, 0, 2 * Math.PI
            );
            ctx.fill();
        }
    });

    // 腰付近を強調表示（負荷インジケータ）
    const hipX = hip.x * canvas.width;
    const hipY = hip.y * canvas.height;

    ctx.beginPath();
    ctx.arc(hipX, hipY, 20, 0, 2 * Math.PI);
    ctx.fillStyle = lineColor + '40'; // 半透明
    ctx.fill();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.stroke();
}

// MediaPipeの推論結果を受け取るコールバック
function onResults(results) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (results.poseLandmarks) {
        drawSkeleton(results.poseLandmarks);
        updateUI(results.poseLandmarks);
    }
}

// MediaPipe Poseの初期化（モデル設定含む）
function initPose() {
    pose = new Pose({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
    });

    pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    pose.onResults(onResults);
}

// カメラ起動（権限取得〜推論開始）
async function startCamera() {
    if (isCameraRunning) return;
    startBtn.disabled = true;
    startBtn.textContent = '起動中...';
    loading.style.display = 'block';

    try {
        initPose();

        camera = new Camera(video, {
            onFrame: async () => {
                await pose.send({ image: video });
            },
            width: 640,
            height: 480
        });

        await camera.start();
        isCameraRunning = true;
        loading.style.display = 'none';
        startBtn.textContent = 'カメラ起動中';
        stopBtn.disabled = false;
    } catch (error) {
        console.error('Camera error:', error);
        loading.style.display = 'none';
        startBtn.disabled = false;
        startBtn.textContent = 'カメラ起動に失敗';
        alert('カメラの起動に失敗しました。カメラへのアクセスを許可してください。');
    }
}

// カメラ停止（ストリーム停止・UI初期化）
function stopCamera() {
    if (!isCameraRunning) return;

    try {
        if (camera && typeof camera.stop === 'function') {
            camera.stop();
        }
    } catch (error) {
        console.warn('Camera stop error:', error);
    }

    const stream = video.srcObject;
    if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => track.stop());
    }
    video.srcObject = null;

    if (pose && typeof pose.close === 'function') {
        pose.close();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    scoreEl.textContent = '--';
    scoreEl.className = 'score-value';
    loadLevelEl.textContent = '--';
    loadLevelEl.className = 'metric-value';
    loadBarEl.style.width = '0%';
    loadBarEl.className = 'metric-bar-fill';
    trunkAngleEl.textContent = '--°';
    trunkAngleEl.className = 'metric-value';
    kneeAngleEl.textContent = '--°';
    kneeAngleEl.className = 'metric-value';

    isCameraRunning = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    startBtn.textContent = 'カメラを起動';
    loading.style.display = 'none';
}

// イベント登録：ボタン操作で起動/停止
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
