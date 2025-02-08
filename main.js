const canvas = document.getElementById('xr-canvas');
const gl = canvas.getContext('webgl2');

// Vertex shader source
const vertexShaderSource = `#version 300 es
in vec3 position;
void main() {
    gl_Position = vec4(position, 1.0);
}`;

// Fragment shader source (your shader code)
const fragmentShaderSource = `#version 300 es
precision highp float;
uniform mat4 iViewMatrixLeft;
uniform mat4 iViewMatrixRight;
uniform mat4 iProjectionMatrixLeft;
uniform mat4 iProjectionMatrixRight;
uniform vec2 iResolution;
uniform float iTime;
uniform samplerCube iChannel0;
out vec4 fragColor;

float rand(vec3 r) { return fract(sin(dot(r.xy,vec2(1.38984*sin(r.z),1.13233*cos(r.z))))*653758.5453); }

#define Iterations 64
#define Thickness 0.1
#define SuperQuadPower 8.0
#define Fisheye 0.5

float truchetarc(vec3 pos)
{
    float r=length(pos.xy);
    return pow(pow(abs(r-0.5),SuperQuadPower)+pow(abs(pos.z-0.5),SuperQuadPower),1.0/SuperQuadPower)-Thickness;
}

float truchetcell(vec3 pos)
{
    return min(min(
    truchetarc(pos),
    truchetarc(vec3(pos.z,1.0-pos.x,pos.y))),
    truchetarc(vec3(1.0-pos.y,1.0-pos.z,pos.x)));
}

float distfunc(vec3 pos)
{
    vec3 cellpos=fract(pos);
    vec3 gridpos=floor(pos);

    float rnd=rand(gridpos);

    if(rnd<1.0/8.0) return truchetcell(vec3(cellpos.x,cellpos.y,cellpos.z));
    else if(rnd<2.0/8.0) return truchetcell(vec3(cellpos.x,1.0-cellpos.y,cellpos.z));
    else if(rnd<3.0/8.0) return truchetcell(vec3(1.0-cellpos.x,cellpos.y,cellpos.z));
    else if(rnd<4.0/8.0) return truchetcell(vec3(1.0-cellpos.x,1.0-cellpos.y,cellpos.z));
    else if(rnd<5.0/8.0) return truchetcell(vec3(cellpos.y,cellpos.x,1.0-cellpos.z));
    else if(rnd<6.0/8.0) return truchetcell(vec3(cellpos.y,1.0-cellpos.x,1.0-cellpos.z));
    else if(rnd<7.0/8.0) return truchetcell(vec3(1.0-cellpos.y,cellpos.x,1.0-cellpos.z));
    else  return truchetcell(vec3(1.0-cellpos.y,1.0-cellpos.x,1.0-cellpos.z));
}

vec3 gradient(vec3 pos)
{
    const float eps=0.0001;
    float mid=distfunc(pos);
    return vec3(
    distfunc(pos+vec3(eps,0.0,0.0))-mid,
    distfunc(pos+vec3(0.0,eps,0.0))-mid,
    distfunc(pos+vec3(0.0,0.0,eps))-mid);
}

void mainVR( out vec4 fragColor, in vec2 fragCoord, in vec3 fragRayOri, in vec3 fragRayDir )
{
    vec3 ray_dir=fragRayDir;
    vec3 ray_pos=fragRayOri;

    float i=float(Iterations);
    for(int j=0;j<Iterations;j++)
    {
        float dist=distfunc(ray_pos);
        ray_pos+=dist*ray_dir;

        if(abs(dist)<0.001) { i=float(j); break; }
    }

    vec3 normal=normalize(gradient(ray_pos));

    float ao=1.0-i/float(Iterations);
    float what=pow(max(0.0,dot(normal,-ray_dir)),2.0);
    float light=ao*what*1.4;

    float z=ray_pos.z/2.0;
    vec3 col=(cos(ray_pos/2.0)+2.0)/3.0;

    vec3 reflected=reflect(ray_dir,normal);
    vec3 env=texture(iChannel0,reflected*reflected*reflected).xyz;

    fragColor=vec4(col*light+0.1*env,1.0);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    const float pi=3.141592;

    bool isLeftEye = fragCoord.x < (iResolution.x / 2.0);

    mat4 viewMatrix = isLeftEye ? iViewMatrixLeft : iViewMatrixRight;
    mat4 projMatrix = isLeftEye ? iProjectionMatrixLeft : iProjectionMatrixRight;

    vec2 ndc = (fragCoord.xy / (iResolution.xy / 2.0)) * 2.0 - 1.0;
    if (!isLeftEye) {
        ndc.x = (fragCoord.x - (iResolution.x / 2.0)) / (iResolution.x / 2.0) * 2.0 - 1.0;
    }

    vec4 rayClip = vec4(ndc, -1.0, 1.0);
    vec4 rayEye = inverse(projMatrix) * rayClip;
    rayEye = vec4(rayEye.xy, -1.0, 0.0);
    vec3 rayWorld = (inverse(viewMatrix) * rayEye).xyz;
    rayWorld = normalize(rayWorld);

    vec3 rayOri = (inverse(viewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

    mainVR(fragColor, fragCoord, rayOri, rayWorld);

    float vignette = pow(1.0 - length(ndc), 0.3);
    fragColor.xyz *= vec3(vignette);
}`;

// Compile shader
function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Create shader program
const vertexShader = compileShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
const fragmentShader = compileShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
}

// Set up WebXR session
navigator.xr.requestSession('immersive-vr').then(session => {
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    function onXRFrame(time, frame) {
        const session = frame.session;
        const pose = frame.getViewerPose(xrReferenceSpace);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);

        for (const view of pose.views) {
            const viewport = session.renderState.baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

            // Set uniforms
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'iViewMatrixLeft'), false, view.transform.matrix);
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'iProjectionMatrixLeft'), false, view.projectionMatrix);
            gl.uniform2f(gl.getUniformLocation(program, 'iResolution'), canvas.width, canvas.height);
            gl.uniform1f(gl.getUniformLocation(program, 'iTime'), performance.now() / 1000);

            // Draw
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        session.requestAnimationFrame(onXRFrame);
    }

    session.requestAnimationFrame(onXRFrame);
});
