import { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faCircleInfo } from '@fortawesome/free-solid-svg-icons'

import config from "./config.js";
import { DriveControlPanel } from "./driveControls";
import { MBotScene } from './scene.js'
import { downloadMapFile } from "./map.js";

function ConnectionStatus({ status }) {
  let msg = "Wait";
  let colour = "#ffd300";
  if (status === true) {
    msg = "Connected";
    colour = "#00ff00";
  }
  else if (status === false) {
    msg = "Not Connected";
    colour = "#ff0000";
  }

  return (
    <div className="status" style={{backgroundColor: colour}}>
      {msg}
    </div>
  );
}

function StatusMessage({ robotPose, robotCell, clickedCell }) {
  let msg = [];
  if(robotPose != null){
    msg.push(
      <p className="robot-info" key="robotInfoPose">
        <i>Robot Pose:</i> (
          <b>x:</b> {robotPose.x.toFixed(3)},&nbsp;
          <b>y:</b> {robotPose.y.toFixed(3)},&nbsp;
          <b>t:</b> {robotPose.theta.toFixed(3)})
      </p>
    );
    msg.push(
      <p className="robot-info" key="robotInfoCell">
        <i>Robot Cell:</i> ({robotCell[0]}, {robotCell[1]})
      </p>
  );
  }
  if (clickedCell.length > 0) {
    msg.push(
      <p className="robot-info" key="robotInfoClicked">
        <i>Clicked:</i>&nbsp;
        <b>x:</b> {clickedCell[2].toFixed(3)},&nbsp;
        <b>y:</b> {clickedCell[3].toFixed(3)},&nbsp;
        Cell: [{clickedCell[1]}, {clickedCell[0]}]
      </p>
    );
  }

  return (
    <div className="status-msg">
      {msg}
    </div>
  );
}

function ToggleSelect({ small, label, explain, checked, onChange, isActive = true }) {
  const [viewInfo, setViewInfo] = useState(false);
  const [top, setTop] = useState(0);

  let sizeCls = "";
  if (small) sizeCls = " small";

  const toggleClasses = isActive ? "slider round" + sizeCls : "slider round disabled" + sizeCls;

  return (
    <div className="toggle-wrapper">
      <div className="row">
        <div className="col-7">
          <span>{label}</span>
        </div>
        <div
          className="col-1 info"
          onMouseEnter={(evt) => {
            setViewInfo(true);
            setTop(evt.clientY - 20);
          }}
          onMouseLeave={() => { setViewInfo(false); }}
        >
          <div className="info-icon">
            <FontAwesomeIcon icon={faCircleInfo} size="xs" />
          </div>
        </div>
        {viewInfo && (
          <span className="explain" style={{ top: top }}>
            {explain}
          </span>
        )}
        <div className="col-4 text-right toggle">
          <label className={"switch" + sizeCls}>
            <input
              type="checkbox"
              className="mx-2"
              checked={checked}
              onChange={isActive ? onChange : null}
              disabled={!isActive}
            />
            <span className={toggleClasses}></span>
          </label>
        </div>
      </div>
    </div>
  );
}

function SLAMControlPanel({ onResetMap, saveMap }) {
  return (
    <>
      <div className="subpanel">
        <div className="button-wrapper-col">
          <button
            className="button"
            onClick={onResetMap}
          >
            Reset Map
          </button>
          <button
            className="button"
            onClick={saveMap}
          >
            Download Map
          </button>
        </div>
      </div>
    </>
  );
}

function MBotSceneWrapper({ mbot, scene, connected, robotDisplay, laserDisplay, mapDisplay,
                            setClickedCell, setRobotPose, setRobotCell}) {
  // Ref for the canvas.
  const canvasWrapperRef = useRef(null);

  // Click callback when the user clicks on the scene.
  const handleCanvasClick = useCallback((pos) => {
    if (!scene.current.loaded) return;
    if (pos.length === 0 || !scene.current.isMapLoaded()) {
      // If the map is not loaded or an empty cell is passed, clear.
      setClickedCell([]);
      return;
    }

    const clickedCell = [...scene.current.pixelsToCell(pos[0], pos[1]),
                         ...scene.current.pixelsToPos(pos[0], pos[1])];
    setClickedCell(clickedCell);
  }, [setClickedCell, scene]);

  // Initialization of the scene.
  useEffect(() => {
    scene.current.init().then(() => {
      scene.current.createScene(canvasWrapperRef.current);
      scene.current.clickCallback = handleCanvasClick;
    }).catch((error) => {
      console.warn(error);
    });

    return () => {
      // Clean up.
    }
  }, [canvasWrapperRef, handleCanvasClick, scene]);

  // Effect to manage subscribing to the pose.
  useEffect(() => {
    if (scene.current.loaded) scene.current.toggleRobotView(robotDisplay);

    let unsubscribe = null;
    if (connected && robotDisplay) {
      unsubscribe = mbot.readOdom((msg) => {
        // Sets the robot position
        setRobotPose({x: msg.x, y: msg.y, theta: msg.theta});
        if (!scene.current.loaded) return;
        scene.current.updateRobot(msg.x, msg.y, msg.theta);
        if (scene.current.isMapLoaded()) {
          const robotCell = scene.current.posToCell(msg.x, msg.y);
          setRobotCell(robotCell);
        }
      });
    }

    // Return the cleanup function which stops the rerender.
    return () => {
      if (unsubscribe) unsubscribe();
    }
  }, [connected, robotDisplay, setRobotPose, setRobotCell, mbot, scene]);

  // Effect to manage subscribing to the Lidar.
  useEffect(() => {
    let unsubscribe = null;
    if (connected && laserDisplay) {
      unsubscribe = mbot.readScan((msg) => {
        if (!scene.current.loaded) return;
        const thetas = msg.ranges.map((_, i) => msg.getAngle(i));
        scene.current.drawLasers(msg.ranges, thetas);
      });
    }
    else {
      if (scene.current.loaded) scene.current.clearLasers();
    }

    // Return the cleanup function which stops the rerender.
    return () => {
      if (unsubscribe) unsubscribe();
    }
  }, [connected, laserDisplay, mbot, scene]);

  // Effect to manage subscribing to the path.
  useEffect(() => {
    let unsubscribe = null;
    if (connected) {
      unsubscribe = mbot.readPath((msg) => {
        if (!scene.current.loaded) return;
        const pathPoints = msg.poses;
        if (pathPoints.length === 0) {
          scene.current.clearPath();  // If path length is zero, clear and return.
        }
        else {
          // Extract coordinates of the path and draw.
          const points = pathPoints.map(item => [item.pose.position.x, item.pose.position.y]);
          scene.current.drawPath(points);
        }
      });
    }

    // Return the cleanup function which stops the rerender.
    return () => {
      if (unsubscribe) unsubscribe();
    }
  }, [connected, mbot, scene]);

  // Effect to request the SLAM map.
  useEffect(() => {
    let unsubscribe = null;

    if (scene.current.loaded) {
      scene.current.clear();  // Clear the scene on change.
    }

    if (connected && mapDisplay) {
      unsubscribe = mbot.readMap((msg) => {
        const headerData = {
          width: msg.info.width,
          height: msg.info.height,
          metersPerCell: msg.info.resolution,
          origin: [msg.info.origin.position.x, msg.info.origin.position.y]
        };

        if (scene.current.loaded) {
          scene.current.setMapHeaderData(headerData.width, headerData.height, headerData.metersPerCell, headerData.origin);
          scene.current.updateCells(msg.data);
        }
      });
    }

    // On quit, stop requesting.
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [connected, mapDisplay, mbot, scene]);

  return (
    <div id="canvas-container" ref={canvasWrapperRef}>
    </div>
  );
}

export default function MBotApp({ mbot }) {
  const scene = useRef(new MBotScene());
  const [hostname, setHostname] = useState("mbot-???");
  const [connected, setConnected] = useState(mbot.connected);
  // Toggle selectors.
  const [robotDisplay, setRobotDisplay] = useState(true);
  const [laserDisplay, setLaserDisplay] = useState(false);
  const [mapDisplay, setMapDisplay] = useState(true);
  const [drivingMode, setDrivingMode] = useState(false);
  // Robot parameters.
  const [robotPose, setRobotPose] = useState({x: 0, y: 0, theta: 0});
  const [robotCell, setRobotCell] = useState([0, 0]);
  // Visualization elements.
  const [clickedCell, setClickedCell] = useState([]);

  // A heartbeat effect that checks if the MBot Bridge backend is connected
  useEffect(() => {
    if (mbot.connected !== connected) {
      setConnected(mbot.connected);
    }

    const onConnect = () => setConnected(true);
    const onClose = () => setConnected(false);

    mbot.ros.on('connection', onConnect);
    mbot.ros.on('close', onClose);
    mbot.ros.on('error', onClose);

    return () => {
      mbot.ros.off('connection', onConnect);
      mbot.ros.off('close', onClose);
      mbot.ros.off('error', onClose);
    };
  }, [mbot, connected]);

  // Effect to set the MBot hostname on first mounting component.
  useEffect(() => {
    if (connected) {
      setHostname(window.location.hostname);
    }
  }, [connected]);

  const onResetMap = useCallback(() => {
    if (!confirm("This will clear the current map. Are you sure?")) return;
    mbot.resetSlam(false).catch(err => console.warn(err));
  }, [mbot]);

  const saveMap = useCallback(() => {
    if (!scene.current.loaded) return;
    const mapData = scene.current.getMapData();

    if (mapData === null) {
      console.log("Error saving map: Invalid map data");
      return;
    }

    downloadMapFile(mapData);
  }, [scene]);

  return (
    <div id="wrapper">
      <div id="main">
        <MBotSceneWrapper mbot={mbot} scene={scene} connected={connected}
                          robotDisplay={robotDisplay}
                          laserDisplay={laserDisplay}
                          mapDisplay={mapDisplay}
                          setClickedCell={setClickedCell}
                          setRobotPose={setRobotPose}
                          setRobotCell={setRobotCell} />
      </div>

      <div id="sidenav">
        <div id="toggle-nav" onClick={() => {}}><FontAwesomeIcon icon={faBars} /></div>
        <div className="inner">
          <div className="title">
            {hostname.toUpperCase()}
          </div>

          <div className="status-wrapper">
            <ConnectionStatus status={connected}/>
            <StatusMessage robotCell={robotCell} robotPose={robotPose}
                           clickedCell={clickedCell} />
          </div>

          <div className="row">
              <SLAMControlPanel onResetMap={() => onResetMap()}
                                saveMap={() => saveMap()} />

              <ToggleSelect label={"Draw Map"} checked={mapDisplay} isActive={connected}
                            explain={"Displays the SLAM map."}
                            onChange={ () => { setMapDisplay(!mapDisplay); } }/>

              { /* Checkboxes for map visualization. */}
              <ToggleSelect label={"Draw Robot"} checked={robotDisplay} isActive={connected}
                            explain={"Displays the robot on the map."}
                            onChange={ () => { setRobotDisplay(!robotDisplay); } }/>

              <ToggleSelect label={"Draw Lasers"} checked={laserDisplay} isActive={connected}
                            explain={"Displays the Lidar rays."}
                            onChange={ () => { setLaserDisplay(!laserDisplay); } }/>

              { /* Drive mode and control panel. */}
              <ToggleSelect label={"Drive Mode"} checked={drivingMode} isActive={connected}
                            explain={"To drive the robot with your keyboard, use A,D for left & right, " +
                                      "W,S for forward & backward, and Q,E to rotate. " +
                                      "Or, use the joystick and turn buttons in the drive panel."}
                            onChange={ () => { setDrivingMode(!drivingMode); } }/>
              {drivingMode &&
                <DriveControlPanel mbot={mbot} drivingMode={drivingMode} />
              }
          </div>
        </div>
      </div>
    </div>
  );
}
