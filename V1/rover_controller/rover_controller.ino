/*
  ============================================================
  ESP8266 ROVER — FUTURISTIC WEB HUD CONTROLLER
  ============================================================
  Controls:
    - 4x TT gear motors (tank drive, wired as LEFT pair / RIGHT pair)
    - Speed cap slider
    - 2x servos (pan / tilt) driven by the right-side joystick
    - Front LED toggle
    - Live connection status over WebSocket (fast, low-latency)

  FILE LAYOUT (this is now a 4-file project):
    rover_controller/
      rover_controller.ino   <- this file (logic only)
      data/index.html        <- page structure
      data/style.css         <- HUD styling
      data/script.js         <- joystick + websocket behaviour

  The data/ folder is uploaded to the ESP8266's flash filesystem
  (LittleFS) separately from the sketch itself — see the upload
  instructions at the bottom of this file.

  REQUIRED LIBRARIES (Arduino IDE > Library Manager):
    - ESP8266WiFi         (bundled with ESP8266 board package)
    - ESPAsyncTCP         by me-no-dev
    - ESPAsyncWebServer   by me-no-dev
    - ArduinoJson         by Benoit Blanchon (v6.x)
    - Servo               (bundled with ESP8266 board package)
    - LittleFS            (bundled with ESP8266 board package)

  WIRING (NodeMCU / Wemos D1 mini pin labels):
    Left  motor pair  -> L298N/BTS7960 channel A
        ENA (PWM)  -> D1 (GPIO5)
        IN1        -> D2 (GPIO4)
        IN2        -> D0 (GPIO16)
    Right motor pair  -> L298N/BTS7960 channel B
        ENB (PWM)  -> D5 (GPIO14)
        IN3        -> D6 (GPIO12)
        IN4        -> D7 (GPIO13)
    Servo 1 (pan)   -> D3 (GPIO0)
    Servo 2 (tilt)  -> D4 (GPIO2)
    Front LED (MOSFET gate or LED+resistor) -> D8 (GPIO15)

  NOTE: Motors draw far more current than the ESP8266 3V3 pin can
  supply — power them from a separate battery through your motor
  driver, and share GND between the driver, ESP8266, and battery.
  ============================================================
*/

#include <ESP8266WiFi.h>
#include <ESPAsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Servo.h>
#include <LittleFS.h>

// ---------------- WiFi credentials ----------------
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ---------------- AP fallback (used only if the WiFi above isn't found) ----------------
const char* AP_SSID = "ROVER-HUD";
const char* AP_PASS = "rover1234";      // must be 8+ chars, or set to "" for open network
const unsigned long STA_TIMEOUT_MS = 8000;  // how long to try connecting before falling back

// ---------------- Pin map ----------------
#define ENA D1
#define IN1 D2
#define IN2 D0
#define ENB D5
#define IN3 D6
#define IN4 D7
#define SERVO1_PIN D3
#define SERVO2_PIN D4
#define LED_PIN    D8

Servo servo1;
Servo servo2;

int servo1Angle = 90;
int servo2Angle = 90;
int speedCap = 100;      // 0-100 %, from the speed slider
bool ledState = false;

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// =========================================================
// MOTOR CONTROL
// =========================================================
void setLeftMotor(int spd) {              // spd: -255..255
  spd = constrain(spd, -255, 255);
  digitalWrite(IN1, spd >= 0 ? HIGH : LOW);
  digitalWrite(IN2, spd >= 0 ? LOW : HIGH);
  analogWrite(ENA, abs(spd));
}

void setRightMotor(int spd) {              // spd: -255..255
  spd = constrain(spd, -255, 255);
  digitalWrite(IN3, spd >= 0 ? HIGH : LOW);
  digitalWrite(IN4, spd >= 0 ? LOW : HIGH);
  analogWrite(ENB, abs(spd));
}

void stopMotors() {
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
}

// Tank-mix a joystick position (x, y in -1..1) into left/right motor speeds
void driveFromJoystick(float x, float y) {
  float left  = y + x;
  float right = y - x;

  float maxMag = max(abs(left), abs(right));
  if (maxMag > 1.0) { left /= maxMag; right /= maxMag; }

  float capScale = speedCap / 100.0;
  setLeftMotor((int)(left  * 255 * capScale));
  setRightMotor((int)(right * 255 * capScale));
}

// =========================================================
// WEBSOCKET HANDLING
// =========================================================
void handleWsMessage(uint8_t *data, size_t len) {
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, data, len);
  if (err) return;

  const char* type = doc["type"];
  if (!type) return;

  if (strcmp(type, "joystick") == 0) {
    float x = doc["x"];
    float y = doc["y"];
    driveFromJoystick(x, y);
  }
  else if (strcmp(type, "stop") == 0) {
    stopMotors();
  }
  else if (strcmp(type, "speed") == 0) {
    speedCap = constrain((int)doc["value"], 0, 100);
  }
  else if (strcmp(type, "servo1") == 0) {
    servo1Angle = constrain((int)doc["value"], 0, 180);
    servo1.write(servo1Angle);
  }
  else if (strcmp(type, "servo2") == 0) {
    servo2Angle = constrain((int)doc["value"], 0, 180);
    servo2.write(servo2Angle);
  }
  else if (strcmp(type, "led") == 0) {
    ledState = doc["state"];
    digitalWrite(LED_PIN, ledState ? HIGH : LOW);
  }
}

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("WS client #%u connected\n", client->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("WS client #%u disconnected — stopping motors\n", client->id());
    stopMotors();
  } else if (type == WS_EVT_DATA) {
    handleWsMessage(data, len);
  }
}

// =========================================================
// SETUP / LOOP
// =========================================================
void setup() {
  Serial.begin(115200);

  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  stopMotors();
  digitalWrite(LED_PIN, LOW);

  servo1.attach(SERVO1_PIN);
  servo2.attach(SERVO2_PIN);
  servo1.write(servo1Angle);
  servo2.write(servo2Angle);

  if (!LittleFS.begin()) {
    Serial.println("LittleFS mount failed! Did you upload the data/ folder?");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < STA_TIMEOUT_MS) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected to WiFi. Rover HUD ready at: http://");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Could not reach WiFi network — starting rover's own hotspot instead.");
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    Serial.print("Hotspot SSID: "); Serial.println(AP_SSID);
    Serial.print("Connect your phone to it, then open: http://");
    Serial.println(WiFi.softAPIP());
  }

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // Serve every file in the LittleFS data/ folder at its matching URL path
  // (index.html -> "/", style.css -> "/style.css", script.js -> "/script.js")
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  server.begin();
}

void loop() {
  ws.cleanupClients();
}

/*
  ============================================================
  UPLOADING data/ TO THE ESP8266 (do this once, and again any
  time you edit index.html / style.css / script.js)
  ============================================================
  Arduino IDE 2.x:
    1. Install the "Arduino LittleFS Upload" plugin:
       https://github.com/earlephilhower/arduino-littlefs-upload
       (download the .vsix release, place it in the IDE's
       plugins folder — the plugin's README covers the exact path
       per OS — then restart the IDE)
    2. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
    3. Run "Upload LittleFS to Pico/ESP8266/ESP32"
       This uploads everything inside data/ to the flash filesystem.

  Arduino IDE 1.8.x:
    1. Install the "ESP8266 LittleFS Data Upload" tool from:
       https://github.com/earlephilhower/arduino-esp8266littlefs-plugin
    2. Restart the IDE, then use Tools > "ESP8266 LittleFS Data Upload"

  After that, upload the sketch itself as usual with the Upload button.
  The two uploads are separate — flashing new sketch code does NOT
  overwrite the filesystem, and vice versa.
  ============================================================
*/
