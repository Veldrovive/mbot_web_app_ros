
var config = {
    ROBOT_SIZE: 0.205,           // m, diameter

    // Driving info
    ANG_VEL_MULTIPLIER: 5.0,  // Scale to multiply values [0-1] for angular velocity.
    DRIVE_CMD_RATE: 100,      // Rate for sending drive commands when active.

    // Display info
    ODOM_DISPLAY_RATE: 10,           // Hz, max rate the sidebar pose readout updates.
    MAP_COLOUR_HIGH: "#000000",      // Occupied (ROS value 100).
    MAP_COLOUR_LOW: "#ffffff",       // Free (ROS value 0).
    MAP_COLOUR_UNKNOWN: "#808080",   // Unknown (ROS value -1).
    PATH_COLOUR: "#ff1919",
};

export default config;
